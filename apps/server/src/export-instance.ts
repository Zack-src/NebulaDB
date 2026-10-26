import "./loadEnv.js";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";
import { exportInstance, rawTypes } from "./infrastructure/instanceArchive.js";
import { backupTimestamp } from "./infrastructure/backupRunner.js";

/**
 * Logical export of NebulaDB's own PostgreSQL data (accounts, projects,
 * revision history, connections, audit log…) to one gzip'd JSONL file, without
 * `pg_dump`. Read-only and consistent (one snapshot): the server may keep running.
 *
 * Usage: `npm run export-instance -- [<file.jsonl.gz>]` (compiled: `export-instance:prod`).
 * Secrets are exported in their encrypted form, never decrypted: the archive
 * restores only with the same NEBULADB_SECRET. Seed files and the other
 * contents of the data volume are not part of it.
 */
async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? `nebuladb-instance-${backupTimestamp()}.jsonl.gz`);
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    application_name: "nebuladb-export",
    types: rawTypes(),
  });
  await client.connect();
  try {
    const result = await exportInstance(client, file, (line) => console.log(line));
    const rows = result.tables.reduce((sum, t) => sum + t.rows, 0);
    console.log(`\nDone: ${rows} row(s) in ${result.tables.length} table(s), schema version ${result.schemaVersion}.`);
    console.log(`Archive: ${file}`);
    console.log(
      "Secrets (connection credentials, 2FA secrets, webhook secrets) are stored encrypted: this archive can only be\n" +
        "restored with the SAME NEBULADB_SECRET — keep that value safe, but not next to the archive.\n" +
        "Not included: sessions and other short-lived tables, seed files and the rest of the data volume (copy it separately).",
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
