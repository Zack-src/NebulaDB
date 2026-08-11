import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readProjectFromDoc } from "@athanordb/shared";
import { projectToDbml } from "@athanordb/dbml-engine";
import { db } from "./db.js";
import { listRevisions, reconstructDocAtRevision } from "../realtime/persistence.js";

/**
 * The backup itself, separated from the CLI in `backup.ts` so the server can
 * also run it on a schedule.
 *
 * A backup path that only ever runs when someone remembers to type the command
 * is a backup path most instances don't have — the script existed and was
 * documented, but nothing in a normal deployment ever called it.
 */

export interface BackupResult {
  dir: string;
  backedUp: number;
  skipped: number;
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "untitled";
}

/** Filesystem-safe ISO timestamp — also the sort key backups are pruned by. */
export function backupTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Writes every project to `<outDir>/<name>.dbml`.
 *
 * Each project is replayed from its revision log rather than read from the
 * debounced snapshot, which can lag live edits by a couple of seconds — a
 * backup taken mid-edit should contain the edit.
 *
 * `log` defaults to no-op: the CLI wants per-project output, the scheduler
 * wants one summary line and not a page of noise every few hours.
 */
export function runBackup(outDir: string, log: (line: string) => void = () => {}): BackupResult {
  mkdirSync(outDir, { recursive: true });

  const projects = db.prepare("SELECT id, name FROM projects ORDER BY name").all() as { id: string; name: string }[];
  const usedNames = new Map<string, number>();
  let backedUp = 0;
  let skipped = 0;

  for (const project of projects) {
    const revisions = listRevisions(project.id);
    if (revisions.length === 0) {
      log(`skip  ${project.name} — no revisions yet (nothing committed to back up)`);
      skipped++;
      continue;
    }

    const doc = reconstructDocAtRevision(project.id, revisions[revisions.length - 1].id);
    if (!doc) {
      log(`skip  ${project.name} — revision log could not be replayed`);
      skipped++;
      continue;
    }

    const liveProject = readProjectFromDoc(doc, project.id, project.name);
    const dbml = projectToDbml(liveProject, { includeVisualMetadata: true });
    doc.destroy();

    const base = sanitizeFilename(project.name);
    const dupeCount = usedNames.get(base) ?? 0;
    usedNames.set(base, dupeCount + 1);
    const filename = dupeCount === 0 ? `${base}.dbml` : `${base}-${dupeCount}.dbml`;

    writeFileSync(path.join(outDir, filename), dbml, "utf-8");
    log(`ok    ${project.name} -> ${filename}`);
    backedUp++;
  }

  return { dir: path.resolve(outDir), backedUp, skipped };
}

/**
 * Keeps the `keep` most recent backup directories under `rootDir` and deletes
 * the rest. Without this, a scheduled backup is a slow disk-filling machine —
 * which on a single-volume self-hosted box takes the database down with it.
 *
 * Only directories whose names look like a backup timestamp are considered, so
 * anything else an operator put in that folder is left alone. Returns how many
 * were removed.
 */
export function pruneOldBackups(rootDir: string, keep: number): number {
  if (keep <= 0) return 0;
  let entries: string[];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return 0; // nothing written yet
  }

  const backups = entries
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
    .filter((name) => {
      try {
        return statSync(path.join(rootDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    // Timestamp names sort chronologically as strings, so no date parsing.
    .sort();

  const doomed = backups.slice(0, Math.max(0, backups.length - keep));
  for (const name of doomed) {
    rmSync(path.join(rootDir, name), { recursive: true, force: true });
  }
  return doomed.length;
}
