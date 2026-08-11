import * as Y from "yjs";
import type { RevisionMeta } from "@athanordb/shared";
import { db } from "../infrastructure/db.js";

export function loadSnapshot(projectId: string): Uint8Array | undefined {
  const row = db.prepare("SELECT yjs_state FROM snapshots WHERE project_id = ?").get(projectId) as
    { yjs_state: Buffer } | undefined;
  return row ? new Uint8Array(row.yjs_state) : undefined;
}

export function saveSnapshot(projectId: string, doc: Y.Doc): void {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  db.prepare(
    `INSERT INTO snapshots (project_id, yjs_state, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(project_id) DO UPDATE SET yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`,
  ).run(projectId, state);
}

export function appendRevision(projectId: string, author: string, update: Uint8Array): void {
  db.prepare(
    `INSERT INTO revisions (id, project_id, author, yjs_update, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(crypto.randomUUID(), projectId, author, Buffer.from(update));
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
 * All Yjs update bytes for a project, from the beginning of its history up to
 * and including `revisionId`, in application order. Returns `null` if no
 * revision with that id exists for the project.
 */
export function getRevisionUpdatesUpTo(projectId: string, revisionId: string): Uint8Array[] | null {
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
