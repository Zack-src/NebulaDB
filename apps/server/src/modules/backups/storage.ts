import crypto from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Transform, pipeline, type Readable } from "node:stream";
import { pipeline as pipelineAsync } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";
import { config } from "../../config.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";

const ALGORITHM = "aes-256-gcm";

/**
 * Where a backup's file lives. The name is the backup's own id (a UUID the
 * server generated), never anything a client sent, so there is no path to
 * escape with.
 */
export function backupFilePath(id: string): string {
  return path.join(config.databaseBackupDir, `${id}.bak`);
}

export function removeBackupFile(id: string): void {
  rmSync(backupFilePath(id), { force: true });
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
  /** Stops and removes the partial file. */
  abort(): Promise<void>;
}

/**
 * Writes a backup as it is read: one JSON document per line → gzip →
 * AES-256-GCM → disk, never whole in memory. Each file has its own random
 * key; the instance secret only encrypts that key, so rotating the secret
 * does not mean rewriting gigabytes.
 */
export function openBackupWriter(id: string): BackupWriter {
  mkdirSync(config.databaseBackupDir, { recursive: true });
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
  const written = pipelineAsync(gzip, cipher, tap, createWriteStream(backupFilePath(id), { mode: 0o600 }));
  // Observed through `finish` / `write`; this only keeps a failure from being an unhandled rejection meanwhile.
  written.catch(() => {});
  let bytes = 0;

  return {
    get bytes() {
      return bytes;
    },
    async write(line) {
      const text = `${JSON.stringify(line)}\n`;
      bytes += Buffer.byteLength(text);
      // Waiting for `drain` alone would hang forever if the disk failed in the meantime.
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
      await written.catch(() => {});
      removeBackupFile(id);
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

/** SHA-256 of the file as stored — compared with the one recorded when it was written before anything reads it. */
export async function backupFileChecksum(id: string): Promise<string | null> {
  const hash = crypto.createHash("sha256");
  try {
    for await (const chunk of createReadStream(backupFilePath(id))) hash.update(chunk as Buffer);
  } catch {
    return null;
  }
  return hash.digest("hex");
}

/** The decrypted file, still gzipped: what a download sends. */
export function openBackupDownload(id: string, keyEncrypted: string): Readable {
  return pipeline(createReadStream(backupFilePath(id)), decipherFor(keyEncrypted), () => {});
}

/** The file's lines, parsed, one at a time. Throws if the file was altered: the cipher's tag no longer matches. */
export async function* readBackupLines(id: string, keyEncrypted: string): AsyncGenerator<unknown> {
  const source = pipeline(createReadStream(backupFilePath(id)), decipherFor(keyEncrypted), createGunzip(), () => {});
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
