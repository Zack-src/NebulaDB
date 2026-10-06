import path from "node:path";
import { backupTimestamp, runBackup } from "./backupRunner.js";

/** CLI wrapper around `runBackup`: dumps every project to `.dbml` without the server running. Usage: `npm run backup -- [outputDir]`. */
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
