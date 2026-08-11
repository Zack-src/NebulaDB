import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as Y from "yjs";
import { writeProjectToDoc } from "@athanordb/shared";
import { applyVisualMetadata, describeDbmlParseError, parseDbml, toProject } from "@athanordb/dbml-engine";
import { db } from "./db.js";
import { saveSnapshot } from "../realtime/persistence.js";

/**
 * Bulk-imports a directory of `.dbml` files — the counterpart to backup.ts,
 * which is the only thing that ever produces this shape. Each file becomes a
 * brand-new project (never overwrites an existing one; the single-project
 * paste/upload route already covers "reimport into a project that already
 * exists"). If the file carries backup.ts's visual-metadata sidecar comment
 * (`projectToDbml(..., { includeVisualMetadata: true })`, which the backup
 * always requests), position/zones/sticky notes come back too — a plain
 * hand-written `.dbml` file restores fine, just without that layout.
 *
 * Usage: `npm run restore -w apps/server -- <backupDir> [--owner email@example.com]`.
 * Respects `ATHANORDB_DB_PATH` the same as the server itself.
 *
 * Ownership: without `--owner`, restored projects have no owner — under
 * `permissions.ts`'s rules that leaves them readable by any logged-in user
 * (the "zero teams assigned" default) but manageable by nobody except a
 * global admin, since there's no "reassign owner" route to fix that up
 * afterward. Pass `--owner` (an existing user's email) to make that user the
 * owner immediately, same as if they'd created the project themselves.
 */
export function parseArgs(argv: string[]): { backupDir: string; ownerEmail?: string } {
  const positional: string[] = [];
  let ownerEmail: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--owner") {
      ownerEmail = argv[i + 1];
      i++;
    } else {
      positional.push(argv[i]);
    }
  }
  const backupDir = positional[0];
  if (!backupDir) {
    console.error("Usage: npm run restore -w apps/server -- <backupDir> [--owner email@example.com]");
    process.exit(1);
  }
  return { backupDir, ownerEmail };
}

/** Reverses backup.ts's `sanitizeFilename` + dedup-suffix as best it can — lossy (the original name's exact spacing/punctuation is gone), but readable. */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.dbml$/i, "").replace(/-\d+$/, "");
  return base.replace(/_/g, " ").trim() || "Restored project";
}

function main(): void {
  const { backupDir, ownerEmail } = parseArgs(process.argv.slice(2));

  let ownerId: string | null = null;
  if (ownerEmail) {
    const owner = db.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail) as { id: string } | undefined;
    if (!owner) {
      console.error(`No user with email ${ownerEmail} — aborting rather than restoring ownerless projects by accident.`);
      process.exit(1);
    }
    ownerId = owner.id;
  } else {
    console.warn(
      "No --owner given — restored projects will have no owner. Any logged-in user can view them " +
        "(the same default a project with no team ever gets), but only a global admin can manage or " +
        "delete them: there's no way to assign an owner after the fact yet.",
    );
  }

  const files = readdirSync(backupDir).filter((f) => f.toLowerCase().endsWith(".dbml"));
  if (files.length === 0) {
    console.log(`No .dbml files found in ${backupDir} — nothing to restore.`);
    return;
  }

  let restored = 0;
  let skipped = 0;

  for (const file of files) {
    const source = readFileSync(path.join(backupDir, file), "utf-8");
    const name = nameFromFilename(file);
    try {
      const database = parseDbml(source);
      const parsed = applyVisualMetadata(toProject(database, name, source), source);

      const id = crypto.randomUUID();
      db.prepare("INSERT INTO projects (id, name, status, owner_id) VALUES (?, ?, 'active', ?)").run(id, name, ownerId);

      const doc = new Y.Doc();
      doc.transact(() => writeProjectToDoc(doc, { ...parsed, id, name }));
      saveSnapshot(id, doc);
      doc.destroy();

      console.log(`ok    ${file} -> "${name}" (${parsed.tables.length} table(s), id ${id})`);
      restored++;
    } catch (err) {
      const info = describeDbmlParseError(err);
      console.log(`skip  ${file} — ${info.message}${info.line ? ` (line ${info.line})` : ""}`);
      skipped++;
    }
  }

  console.log(`\n${restored} project(s) restored, ${skipped} skipped.`);
}

// Only run as a side effect of the CLI entry point (`tsx src/restore.ts ...`)
// — not when this module is imported for its exported helpers, e.g. by
// restore.test.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
