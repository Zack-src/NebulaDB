import crypto from "node:crypto";
import path from "node:path";
import { PassThrough, pipeline, type Readable } from "node:stream";
import SftpClient from "ssh2-sftp-client";
import type { SftpDestinationSettings } from "@nebuladb/shared";
import { resolveAllowedHost } from "../../connections/hostGuard.js";
import { ObjectMissingError, type BackupStore, type SftpSecret } from "./types.js";

const CONNECT_TIMEOUT_MS = 15_000;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

/**
 * The fingerprint as `ssh-keygen -lf` prints it (`SHA256:` and 43 base64
 * characters, padding dropped); `null` for anything else. MD5 and bare hashes
 * are refused rather than guessed at.
 */
export function normalizeFingerprint(value: string): string | null {
  const trimmed = value.trim().replace(/=+$/, "");
  return FINGERPRINT.test(trimmed) ? trimmed : null;
}

/** A server's host key (the raw blob the handshake carries) as its fingerprint. */
export function fingerprintOf(hostKey: Buffer): string {
  return `SHA256:${crypto.createHash("sha256").update(hostKey).digest("base64").replace(/=+$/, "")}`;
}

/** An SFTP error in words: the library prefixes its own context, the server's message is what helps. */
export function sftpReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `ssh2`'s "no such file" is status 2, which `ssh2-sftp-client` wraps with code `ENOENT`. */
function isMissing(err: unknown): boolean {
  const e = err as { code?: unknown; message?: string };
  return e.code === 2 || e.code === "ENOENT" || /no such file/i.test(e.message ?? "");
}

/**
 * An SFTP server, over `ssh2-sftp-client` (which wraps `ssh2`). Every operation
 * opens its own connection: the server's host key must match the fingerprint
 * that was saved, or the handshake is refused before any credential is sent —
 * an unknown key is never accepted. The host goes through the same outbound
 * check as database connections, and the connection is made to the address
 * that was checked.
 */
export class SftpStore implements BackupStore {
  readonly kind = "sftp" as const;
  private readonly expected: string;

  constructor(
    private readonly settings: SftpDestinationSettings,
    private readonly secret: SftpSecret,
  ) {
    const expected = normalizeFingerprint(settings.hostKeyFingerprint);
    if (!expected) throw new Error("the host key fingerprint must look like SHA256:… (see `ssh-keygen -lf`)");
    this.expected = expected;
  }

  private remotePath(name: string): string {
    return path.posix.join(this.settings.remoteDir, name);
  }

  private async connect(): Promise<SftpClient> {
    const pinned = await resolveAllowedHost(this.settings.host);
    const client = new SftpClient();
    let seen = "";
    try {
      await client.connect({
        host: pinned?.address ?? this.settings.host,
        port: this.settings.port,
        username: this.settings.username,
        password: this.secret.password,
        privateKey: this.secret.privateKey,
        passphrase: this.secret.passphrase,
        readyTimeout: CONNECT_TIMEOUT_MS,
        keepaliveInterval: 10_000,
        hostVerifier: (hostKey: Buffer) => {
          seen = fingerprintOf(hostKey);
          return seen === this.expected;
        },
      });
    } catch (err) {
      await client.end().catch(() => {});
      if (seen && seen !== this.expected) {
        throw new Error(`the server's host key (${seen}) does not match the saved fingerprint (${this.expected})`, {
          cause: err,
        });
      }
      throw err;
    }
    // A dropped connection between operations would otherwise be an unhandled 'error' event.
    client.on("error", () => {});
    return client;
  }

  private async withClient<T>(action: (client: SftpClient) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      return await action(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  async write(name: string, source: Readable): Promise<void> {
    const remote = this.remotePath(name);
    const client = await this.connect();
    try {
      // Through a pass-through that fails with the source: one destroyed without an error (a cancel)
      // would otherwise leave the transfer waiting for data that never comes.
      const guarded = pipeline(source, new PassThrough(), () => {});
      await client.put(guarded, remote, { writeStreamOptions: { mode: 0o600 } });
    } catch (err) {
      // Whatever the transfer was doing is dropped with its connection; the partial file goes over a fresh one.
      await client.end().catch(() => {});
      await this.delete(name).catch(() => {});
      throw err;
    } finally {
      await client.end().catch(() => {});
    }
  }

  async read(name: string): Promise<Readable> {
    const client = await this.connect();
    try {
      const remote = this.remotePath(name);
      try {
        await client.stat(remote);
      } catch (err) {
        if (isMissing(err)) throw new ObjectMissingError(name);
        throw err;
      }
      const stream = client.createReadStream(remote);
      // The connection lives as long as the stream is read.
      stream.once("close", () => void client.end().catch(() => {}));
      return stream;
    } catch (err) {
      await client.end().catch(() => {});
      throw err;
    }
  }

  async delete(name: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.delete(this.remotePath(name), true);
    });
  }

  async probe(): Promise<void> {
    await this.withClient(async (client) => {
      await client.mkdir(this.settings.remoteDir, true);
      const remote = this.remotePath(`.nebuladb-write-test-${crypto.randomUUID()}`);
      const body = crypto.randomBytes(16);
      await client.put(body, remote);
      try {
        const back = (await client.get(remote)) as Buffer;
        if (!back.equals(body)) throw new Error("the probe file read back differently from what was written");
      } finally {
        await client.delete(remote, true).catch(() => {});
      }
    });
  }
}
