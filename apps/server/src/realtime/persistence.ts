import * as Y from "yjs";
import type { RevisionChanges, RevisionMeta } from "@nebuladb/shared";
import { readProjectFromDoc } from "@nebuladb/shared";
import { diffProjects, type ProjectDiff } from "@nebuladb/dbml-engine";
import { db } from "../infrastructure/db.js";
import { timeSync } from "../infrastructure/perf.js";

export function loadSnapshot(projectId: string): Uint8Array | undefined {
  const row = db.prepare("SELECT yjs_state FROM snapshots WHERE project_id = ?").get(projectId) as
    { yjs_state: Buffer } | undefined;
  return row ? new Uint8Array(row.yjs_state) : undefined;
}

export function saveSnapshot(projectId: string, doc: Y.Doc): void {
  // On a large schema, `encodeStateAsUpdate` serializes the *entire* doc, and
  // the write is a synchronous `better-sqlite3` call — both run on the event
  // loop, so a slow one here stalls every connected client's WS frame until
  // it returns, not just this project's.
  timeSync("persistence.saveSnapshot", () => {
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    db.prepare(
      `INSERT INTO snapshots (project_id, yjs_state, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`,
    ).run(projectId, state);
  });
}

export function appendRevision(projectId: string, author: string, update: Uint8Array): void {
  // Runs on *every* Yjs update from *every* connected client — dragging a
  // table alone commits one on mouse-up, but a big multi-user session can
  // still fire this several times a second. Synchronous like `saveSnapshot`
  // above, for the same reason.
  timeSync("persistence.appendRevision", () => {
    db.prepare(
      `INSERT INTO revisions (id, project_id, author, yjs_update, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(crypto.randomUUID(), projectId, author, Buffer.from(update));
  });
}

/** The project's most recent revision, or `null` before its first edit. */
export function latestRevisionId(projectId: string): string | null {
  const row = db.prepare("SELECT id FROM revisions WHERE project_id = ? ORDER BY rowid DESC LIMIT 1").get(projectId) as
    { id: string } | undefined;
  return row?.id ?? null;
}

/** Names a revision as a checkpoint (e.g. "v1.0"), or clears the label with `null`. Returns false if no such revision exists for the project. */
export function setRevisionLabel(projectId: string, revisionId: string, label: string | null): boolean {
  const result = db
    .prepare(`UPDATE revisions SET label = ? WHERE id = ? AND project_id = ?`)
    .run(label, revisionId, projectId);
  return result.changes > 0;
}

export function listRevisions(projectId: string): RevisionMeta[] {
  // `created_at` only has 1s resolution (SQLite `datetime('now')`), so a burst
  // of edits within the same second would tie under that ordering. `rowid` is
  // SQLite's implicit, monotonically-increasing insertion order and costs
  // nothing extra to expose.
  return db
    .prepare(`SELECT id, author, label, created_at AS createdAt FROM revisions WHERE project_id = ? ORDER BY rowid ASC`)
    .all(projectId) as RevisionMeta[];
}

/**
 * `listRevisions`, minus entries that made no schema change over the one before them
 * (dragging a table commits a revision on every mouse-up). Restoring any revision still works;
 * only the *list* is filtered. A labeled revision is always kept.
 *
 * "Changed" is `diffProjects`'s notion (tables/fields/refs). Each kept revision carries
 * `changes`, the short form of that diff. Replays the log once into a scratch doc: O(revisions).
 */
export function listMeaningfulRevisions(projectId: string): RevisionMeta[] {
  const rows = db
    .prepare(
      `SELECT id, author, label, created_at AS createdAt, yjs_update FROM revisions WHERE project_id = ? ORDER BY rowid ASC`,
    )
    .all(projectId) as (RevisionMeta & { yjs_update: Buffer })[];

  return timeSync("persistence.listMeaningfulRevisions", () => {
    const doc = new Y.Doc();
    try {
      let previousProject = readProjectFromDoc(doc, projectId);
      const kept: RevisionMeta[] = [];
      for (const row of rows) {
        Y.applyUpdate(doc, new Uint8Array(row.yjs_update));
        const project = readProjectFromDoc(doc, projectId);
        const diff = diffProjects(previousProject, project);
        const changed = diff.tables.length > 0 || diff.refs.length > 0;
        if (changed || row.label) {
          kept.push({
            id: row.id,
            author: row.author,
            label: row.label,
            createdAt: row.createdAt,
            ...(changed ? { changes: summarizeChanges(diff) } : {}),
          });
        }
        previousProject = project;
      }
      return kept;
    } finally {
      doc.destroy();
    }
  });
}

/** Tables listed by name in a revision's summary; the rest are only counted. */
const SUMMARY_TABLES = 8;

function summarizeChanges(diff: ProjectDiff): RevisionChanges {
  return {
    tables: diff.tables.slice(0, SUMMARY_TABLES).map((table) => ({ name: table.name, status: table.status })),
    moreTables: Math.max(0, diff.tables.length - SUMMARY_TABLES),
    refs: diff.refs.length,
  };
}

/**
 * All Yjs update bytes for a project, from the beginning of its history up to
 * and including `revisionId`, in application order. Returns `null` if no
 * revision with that id exists for the project.
 */
function getRevisionUpdatesUpTo(projectId: string, revisionId: string): Uint8Array[] | null {
  const rows = db
    .prepare(`SELECT id, yjs_update FROM revisions WHERE project_id = ? ORDER BY rowid ASC`)
    .all(projectId) as { id: string; yjs_update: Buffer }[];
  const idx = rows.findIndex((r) => r.id === revisionId);
  if (idx === -1) return null;
  return rows.slice(0, idx + 1).map((r) => new Uint8Array(r.yjs_update));
}

/** Replays a project's revision log up to `revisionId` into a fresh, disconnected Y.Doc. */
export function reconstructDocAtRevision(projectId: string, revisionId: string): Y.Doc | null {
  const updates = getRevisionUpdatesUpTo(projectId, revisionId);
  if (!updates) return null;
  const doc = new Y.Doc();
  updates.forEach((update) => Y.applyUpdate(doc, update));
  return doc;
}
