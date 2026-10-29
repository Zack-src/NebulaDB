import crypto from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ObjectMissingError, type BackupStore } from "./types.js";

/**
 * A folder of the server — local, or a mounted network share. Where backups
 * have always gone; the files are named and written exactly as before.
 */
export class LocalStore implements BackupStore {
  readonly kind = "local" as const;

  constructor(readonly directory: string) {}

  /** The path of an object — the name is a UUID the server made, so there is nothing to escape. */
  pathOf(name: string): string {
    return path.join(this.directory, name);
  }

  async write(name: string, source: Readable): Promise<void> {
    mkdirSync(this.directory, { recursive: true });
    try {
      await pipeline(source, createWriteStream(this.pathOf(name), { mode: 0o600 }));
    } catch (err) {
      rmSync(this.pathOf(name), { force: true });
      throw err;
    }
  }

  async read(name: string): Promise<Readable> {
    try {
      await stat(this.pathOf(name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ObjectMissingError(name);
      throw err;
    }
    return createReadStream(this.pathOf(name));
  }

  // Synchronous inside: the file is gone when this is called, whether or not the promise is awaited.
  async delete(name: string): Promise<void> {
    rmSync(this.pathOf(name), { force: true });
  }

  /** Creates the folder if needed and writes a file there. Throws the system's own error (no such share, permission denied…). */
  async probe(): Promise<void> {
    mkdirSync(this.directory, { recursive: true });
    const probe = this.pathOf(`.nebuladb-write-test-${crypto.randomUUID()}`);
    writeFileSync(probe, "", { mode: 0o600 });
    rmSync(probe, { force: true });
  }
}
