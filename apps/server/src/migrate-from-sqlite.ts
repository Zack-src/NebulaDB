import "./loadEnv.js";
import { db } from "./infrastructure/db.js";
import { importSqliteFile, SqliteImportRefused } from "./infrastructure/sqliteImport.js";

/**
 * Moves an instance that ran on SQLite to PostgreSQL: copies every table of
 * its file into the (new, empty) database `NEBULADB_DATABASE_URL` points at.
 *
 * Usage: `npm run migrate-from-sqlite -- <path-to-sqlite-file>`, with the
 * server stopped. The file is only read. It must have been brought to the
 * last SQLite schema by the last SQLite release first. All-or-nothing: an
 * error leaves the PostgreSQL database as it was.
 */
async function main(): Promise<void> {
  const [, , sqlitePath] = process.argv;
  if (!sqlitePath) {
    console.error("Usage: npm run migrate-from-sqlite -- <path-to-sqlite-file>");
    process.exit(1);
  }
  try {
    const copied = await importSqliteFile(sqlitePath, (line) => console.log(line));
    const rows = copied.reduce((sum, table) => sum + table.rows, 0);
    console.log(
      `\nDone: ${rows} row(s) in ${copied.length} table(s). Start the server; keep the SQLite file as a backup.`,
    );
  } catch (err) {
    if (err instanceof SqliteImportRefused) console.error(`Nothing was copied: ${err.message}`);
    else console.error("Nothing was copied — the copy failed and was rolled back:", err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

await main();
