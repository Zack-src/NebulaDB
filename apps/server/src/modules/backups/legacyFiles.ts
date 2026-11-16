import crypto from "node:crypto";
import { Transform, pipeline } from "node:stream";
import { config } from "../../config.js";
import { db } from "../../infrastructure/db.js";
import { DatabaseStore, LocalStore, ObjectMissingError } from "./stores/index.js";

/**
 * Backups written before they were kept in the database are files in the instance's folder
 * (`NEBULADB_DATABASE_BACKUP_DIR`). This moves each of them into `backup_chunks` and removes the file —
 * once, as the server starts; a backup it cannot move (the file is gone, its checksum no longer matches) is left
 * as it was and reported by the next restore or download as it always was. A connection's own folder and the
 * remote destinations are choices somebody made: they are not touched.
 *
 * Returns how many backups were moved.
 */
export async function moveBackupFilesToDatabase(log: (line: string) => void = () => {}): Promise<number> {
  const rows = (await db
    .prepare(
      `SELECT id, checksum FROM backups
       WHERE NOT in_database AND dir IS NULL AND destination_id IS NULL AND checksum IS NOT NULL
       ORDER BY started_at`,
    )
    .all()) as { id: string; checksum: string }[];
  if (rows.length === 0) return 0;

  const folder = new LocalStore(config.databaseBackupDir);
  const target = new DatabaseStore();
  let moved = 0;
  for (const { id, checksum } of rows) {
    const name = `${id}.bak`;
    try {
      // The bytes are checked on their way: a file altered since it was written is not carried over as if it were whole.
      // Hashed inside the stream itself: a side listener would set it flowing before the copy starts reading.
      const hash = crypto.createHash("sha256");
      const checked = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await target.write(
        name,
        pipeline(await folder.read(name), checked, () => {}),
      );
      if (hash.digest("hex") !== checksum) {
        await target.delete(name);
        log(`backup ${id}: its file does not match its checksum, left in the folder`);
        continue;
      }
      await db.prepare("UPDATE backups SET in_database = TRUE WHERE id = ?").run(id);
      await folder.delete(name);
      moved++;
    } catch (err) {
      if (err instanceof ObjectMissingError) continue;
      await target.delete(name).catch(() => {});
      log(`backup ${id}: not moved to the database (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return moved;
}
