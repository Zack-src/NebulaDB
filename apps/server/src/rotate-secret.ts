import { readEnv } from "./shared/brandMigration.js";
import { db } from "./infrastructure/db.js";
import { reencryptPayload } from "./shared/crypto.js";

/**
 * Re-encrypts everything stored at rest with the current `NEBULADB_SECRET`.
 *
 * 1. Set `NEBULADB_SECRET_PREVIOUS` to the old secret and `NEBULADB_SECRET` to the new one.
 * 2. Run `npm run rotate-secret`.
 * 3. Remove `NEBULADB_SECRET_PREVIOUS`.
 *
 * Safe to re-run. All-or-nothing: a value neither key can read aborts before any change.
 */
const TARGETS = [
  { table: "db_connections", key: "id", column: "config_encrypted" },
  { table: "db_connection_credentials", key: "id", column: "secret_encrypted" },
  { table: "project_webhooks", key: "id", column: "secret_encrypted" },
  { table: "users", key: "id", column: "totp_secret_encrypted" },
  // Each backup file has its own key; this is that key, not the file.
  { table: "backups", key: "id", column: "key_encrypted" },
];

function main(): void {
  if (!readEnv("NEBULADB_SECRET")?.trim()) {
    console.error("NEBULADB_SECRET must be set to the new secret.");
    process.exit(1);
  }
  let total = 0;
  try {
    db.transaction(() => {
      for (const { table, key, column } of TARGETS) {
        const rows = db
          .prepare(`SELECT ${key} AS id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`)
          .all() as {
          id: string;
          value: string;
        }[];
        const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`);
        for (const row of rows) update.run(reencryptPayload(row.value), row.id);
        console.log(`${table}.${column}: ${rows.length} value(s) re-encrypted`);
        total += rows.length;
      }
    })();
  } catch (err) {
    console.error(
      "Rotation aborted, nothing was changed. A stored value could not be decrypted with NEBULADB_SECRET or " +
        "NEBULADB_SECRET_PREVIOUS:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }
  console.log(`Done: ${total} value(s). NEBULADB_SECRET_PREVIOUS can now be removed.`);
}

main();
