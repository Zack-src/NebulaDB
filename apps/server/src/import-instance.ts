import "./loadEnv.js";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";
// Importing `db.js` is what brings the (new) database to the latest schema.
import { db } from "./infrastructure/db.js";
import { importInstance, InstanceImportRefused, rawTypes } from "./infrastructure/instanceArchive.js";

/**
 * Restores an archive made by `export-instance` into the new, EMPTY database
 * `NEBULADB_DATABASE_URL` points at (migrated on the way, like at server start).
 *
 * Usage: `npm run import-instance -- <file.jsonl.gz>` (compiled: `import-instance:prod`),
 * with the server stopped. There is no way to overwrite existing data: a
 * database holding users, projects or anything else is refused. All or nothing:
 * one transaction, row counts and checksums verified against the archive's
 * manifest before it commits. Needs the same NEBULADB_SECRET as the source.
 */
async function main(): Promise<void> {
  const [, , fileArg] = process.argv;
  if (!fileArg) {
    console.error("Usage: npm run import-instance -- <file.jsonl.gz>");
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    application_name: "nebuladb-import",
    types: rawTypes(),
  });
  await client.connect();
  try {
    const result = await importInstance(client, path.resolve(fileArg), (line) => console.log(line));
    const rows = result.tables.reduce((sum, t) => sum + t.rows, 0);
    console.log(
      `\nDone: ${rows} row(s) in ${result.tables.length} table(s) (archive schema version ${result.schemaVersion}).`,
    );
    console.log(
      "Make sure NEBULADB_SECRET is the one the archive was exported with, restore the data volume, then start the server.",
    );
  } catch (err) {
    if (err instanceof InstanceImportRefused) console.error(`Nothing was restored: ${err.message}`);
    else console.error("Nothing was restored — the import failed and was rolled back:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
    await db.close();
  }
}

await main();
