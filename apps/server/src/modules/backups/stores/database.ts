import { Readable } from "node:stream";
import { db } from "../../../infrastructure/db.js";
import { ObjectMissingError, type BackupStore } from "./types.js";

/** One row of `backup_chunks`: big enough to keep the row count low, small enough to never be a memory or protocol problem. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

/** How many chunks one read query brings back: the stream never holds more than this many at once. */
const READ_AHEAD = 4;

/** `<backup id>.bak` → the backup's id. */
function backupIdOf(name: string): string {
  return name.replace(/\.bak$/, "");
}

/**
 * Where backups go unless an administrator picked a folder or a remote: the
 * instance's own PostgreSQL, in `backup_chunks` — so a backup follows the
 * database (dumps, replicas, the volume it already has) instead of a folder
 * somebody has to remember to mount, copy or keep out of version control.
 * What arrives is already gzipped and encrypted by `storage.ts`; a row is a
 * slice of opaque bytes. Never held whole in memory, in either direction.
 */
export class DatabaseStore implements BackupStore {
  readonly kind = "database" as const;

  async write(name: string, source: Readable): Promise<void> {
    const id = backupIdOf(name);
    // Like a file or an object, writing over a name replaces what was there.
    await this.delete(name);
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let seq = 0;
    const flush = async (): Promise<void> => {
      if (pendingBytes === 0) return;
      const data = Buffer.concat(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
      await db.prepare("INSERT INTO backup_chunks (backup_id, seq, data) VALUES (?, ?, ?)").run(id, seq++, data);
    };
    try {
      for await (const chunk of source) {
        const buffer = chunk as Buffer;
        pending.push(buffer);
        pendingBytes += buffer.length;
        if (pendingBytes >= CHUNK_BYTES) await flush();
      }
      await flush();
    } catch (err) {
      await this.delete(name).catch(() => {});
      throw err;
    }
  }

  async read(name: string): Promise<Readable> {
    const id = backupIdOf(name);
    const first = await db.prepare("SELECT 1 AS present FROM backup_chunks WHERE backup_id = ? LIMIT 1").get(id);
    if (!first) throw new ObjectMissingError(name);
    return Readable.from(
      (async function* () {
        let next = 0;
        for (;;) {
          const rows = (await db
            .prepare("SELECT data FROM backup_chunks WHERE backup_id = ? AND seq >= ? ORDER BY seq LIMIT ?")
            .all(id, next, READ_AHEAD)) as { data: Buffer }[];
          if (rows.length === 0) return;
          for (const row of rows) yield row.data;
          next += rows.length;
        }
      })(),
    );
  }

  async delete(name: string): Promise<void> {
    await db.prepare("DELETE FROM backup_chunks WHERE backup_id = ?").run(backupIdOf(name));
  }

  /** The database is the instance's own: if the server is up, it is reachable. */
  async probe(): Promise<void> {
    await db.prepare("SELECT 1").get();
  }
}
