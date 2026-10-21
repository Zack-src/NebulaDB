import crypto from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { Transform, pipeline, type Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";
import { config } from "../../config.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";
import { ApiError } from "../../shared/errors.js";
import { backupPlacement, loadRemoteDestination } from "./destinations.js";
import { LocalStore, ObjectMissingError, openRemoteStore, storeReason, type BackupStore } from "./stores/index.js";

const ALGORITHM = "aes-256-gcm";

/** The name of a backup's object, in whatever store holds it: its own id (a UUID the server generated), never anything a client sent. */
const objectName = (id: string) => `${id}.bak`;

/**
 * Where a backup's file lives when it is kept in a folder: the folder it was
 * written to — its connection's destination at the time, or the instance's
 * own. A remote one has no path (`backupStore` is the general door).
 */
export async function backupFilePath(id: string): Promise<string> {
  return path.join((await backupPlacement(id)).dir ?? config.databaseBackupDir, objectName(id));
}

/**
 * The store a backup was written to, as recorded with the backup itself — not
 * the connection's current destination, which may have changed since.
 */
export async function backupStore(id: string): Promise<BackupStore> {
  const { dir, destinationId } = await backupPlacement(id);
  if (destinationId === null) return new LocalStore(dir ?? config.databaseBackupDir);
  try {
    const remote = await loadRemoteDestination(destinationId);
    if (!remote) throw new Error("the destination this backup was written to is no longer recorded");
    return openRemoteStore(remote);
  } catch (err) {
    throw unreachable(err);
  }
}

function unreachable(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError("BACKUP_STORAGE_UNREACHABLE", { details: { reason: storeReason(err) } });
}

/** Removes a backup's object from a store already in hand; one that is already gone is not an error, an unreachable store is. */
export async function removeFromStore(store: BackupStore, id: string): Promise<void> {
  try {
    await store.delete(objectName(id));
  } catch (err) {
    throw unreachable(err);
  }
}

/** Removes a backup's file wherever it is kept. */
export async function removeBackupFile(id: string): Promise<void> {
  await removeFromStore(await backupStore(id), id);
}

/**
 * The backup's stored bytes. Refuses with `BACKUP_CORRUPTED` when the object is
 * not there, `BACKUP_STORAGE_UNREACHABLE` (with the remote's own message) when
 * the store cannot be reached — never a stream that fails half-way for that.
 */
async function openStored(id: string): Promise<Readable> {
  const store = await backupStore(id);
  try {
    return await store.read(objectName(id));
  } catch (err) {
    if (err instanceof ObjectMissingError) throw new ApiError("BACKUP_CORRUPTED");
    throw unreachable(err);
  }
}

/** A backup file's own key, kept next to it in the database — itself encrypted with the instance secret. */
interface FileKey {
  key: string;
  iv: string;
  tag: string;
}

export interface StoredBackup {
  sizeBytes: number;
  checksum: string;
  /** `FileKey`, encrypted by `shared/crypto.ts`: what `rotate-secret` re-encrypts, without touching the file. */
  keyEncrypted: string;
}

export interface BackupWriter {
  /** Bytes of JSON written so far, before compression — what the size ceiling is measured against. */
  readonly bytes: number;
  write(line: unknown): Promise<void>;
  finish(): Promise<StoredBackup>;
  /** Stops and removes the partial file or object. */
  abort(): Promise<void>;
}

/**
 * Writes a backup as it is read: one JSON document per line → gzip →
 * AES-256-GCM → its store (a folder, S3, SFTP), never whole in memory. Each
 * file has its own random key; the instance secret only encrypts that key, so
 * rotating the secret does not mean rewriting gigabytes. What reaches the
 * store is already encrypted.
 */
export async function openBackupWriter(id: string): Promise<BackupWriter> {
  const store = await backupStore(id);
  const name = objectName(id);
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const gzip = createGzip();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });
  // A failure anywhere in the chain destroys the rest of it, which makes the store drop what it has so far.
  const encrypted = pipeline(gzip, cipher, tap, () => {});
  let failure: ApiError | null = null;
  const written = store.write(name, encrypted).catch((err: unknown) => {
    failure = unreachable(err);
    throw failure;
  });
  // Observed through `finish` / `write`; this only keeps a failure from being an unhandled rejection meanwhile.
  written.catch(() => {});
  let bytes = 0;

  return {
    get bytes() {
      return bytes;
    },
    async write(line) {
      if (failure) throw failure;
      const text = `${JSON.stringify(line)}\n`;
      bytes += Buffer.byteLength(text);
      // Waiting for `drain` alone would hang forever if the store failed in the meantime.
      if (!gzip.write(text)) await Promise.race([once(gzip, "drain"), written]);
    },
    async finish() {
      gzip.end();
      await written;
      const fileKey: FileKey = {
        key: key.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      };
      return { sizeBytes, checksum: hash.digest("hex"), keyEncrypted: encryptPayload(fileKey) };
    },
    async abort() {
      gzip.destroy();
      // A store drops its partial object itself when the transfer fails; one that had already finished is removed here.
      const complete = await written.then(
        () => true,
        () => false,
      );
      if (complete) await store.delete(name).catch(() => {});
    },
  };
}

function decipherFor(keyEncrypted: string): crypto.DecipherGCM {
  const fileKey = decryptPayload<FileKey>(keyEncrypted);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(fileKey.key, "base64"),
    Buffer.from(fileKey.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(fileKey.tag, "base64"));
  return decipher;
}

/**
 * SHA-256 of the file as stored — compared with the one recorded when it was written before anything reads it.
 * `null` when the file is missing; throws `BACKUP_STORAGE_UNREACHABLE` when a remote store cannot be reached.
 */
export async function backupFileChecksum(id: string): Promise<string | null> {
  const store = await backupStore(id);
  const hash = crypto.createHash("sha256");
  try {
    for await (const chunk of await store.read(objectName(id))) hash.update(chunk as Buffer);
  } catch (err) {
    if (err instanceof ObjectMissingError || store.kind === "local") return null;
    throw unreachable(err);
  }
  return hash.digest("hex");
}

/** The decrypted file, still gzipped: what a download sends. */
export async function openBackupDownload(id: string, keyEncrypted: string): Promise<Readable> {
  return pipeline(await openStored(id), decipherFor(keyEncrypted), () => {});
}

/** The file's lines, parsed, one at a time. Throws if the file was altered: the cipher's tag no longer matches. */
export async function* readBackupLines(id: string, keyEncrypted: string): AsyncGenerator<unknown> {
  const source = pipeline(await openStored(id), decipherFor(keyEncrypted), createGunzip(), () => {});
  const decoder = new StringDecoder("utf8");
  let pending = "";
  try {
    for await (const chunk of source) {
      pending += decoder.write(chunk as Buffer);
      let start = 0;
      for (let newline = pending.indexOf("\n"); newline !== -1; newline = pending.indexOf("\n", start)) {
        yield JSON.parse(pending.slice(start, newline));
        start = newline + 1;
      }
      pending = pending.slice(start);
    }
    pending += decoder.end();
    if (pending.trim() !== "") yield JSON.parse(pending);
  } finally {
    source.destroy();
  }
}
