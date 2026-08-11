import path from "node:path";
import { backupTimestamp, runBackup } from "./backupRunner.js";

/**
 * CLI wrapper around `runBackup`. Dumps every project to a `.dbml` file — a
 * basic, dependency-free backup path that doesn't require the server to be
 * running.
 *
 * Usage: `npm run backup -w apps/server -- [outputDir]` (defaults to
 * `./backups/<timestamp>/`). Respects `ATHANORDB_DB_PATH` the same as the
 * server itself, so it reads whichever database the server is actually using.
 *
 * The same function runs on a schedule inside the server when
 * `ATHANORDB_BACKUP_INTERVAL_HOURS` is set — see `index.ts`.
 */
function main(): void {
  const outDir = process.argv[2] ?? path.join("backups", backupTimestamp());
  const result = runBackup(outDir, (line) => console.log(line));

  if (result.backedUp === 0 && result.skipped === 0) {
    console.log("No projects found — nothing to back up.");
    return;
  }
  console.log(`\n${result.backedUp} project(s) backed up, ${result.skipped} skipped, written to ${result.dir}`);
}

main();
