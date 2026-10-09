import * as Y from "yjs";
import type { RevisionChanges, RevisionMeta } from "@nebuladb/shared";
import { readProjectFromDoc } from "@nebuladb/shared";
import { diffProjects, type ProjectDiff } from "@nebuladb/dbml-engine";
import { db } from "../infrastructure/db.js";
import { timeAsync, timeSync } from "../infrastructure/perf.js";

export async function loadSnapshot(projectId: string): Promise<Uint8Array | undefined> {
  const row = (await db.prepare("SELECT yjs_state FROM snapshots WHERE project_id = ?").get(projectId)) as
    { yjs_state: Buffer } | undefined;
  return row ? new Uint8Array(row.yjs_state) : undefined;
}

/**
 * Stores a state already encoded with `Y.encodeStateAsUpdate`. Split from
 * `saveSnapshot` for the room, which has to encode while its doc is still
 * alive but may only write once its earlier writes have landed.
 */
export async function saveSnapshotState(projectId: string, state: Uint8Array): Promise<void> {
  await timeAsync("persistence.saveSnapshot", () =>
    db
      .prepare(
        `INSERT INTO snapshots (project_id, yjs_state, updated_at) VALUES (?, ?, utc_now())
         ON CONFLICT(project_id) DO UPDATE SET yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`,
      )
      .run(projectId, Buffer.from(state)),
  );
}

export async function saveSnapshot(projectId: string, doc: Y.Doc): Promise<void> {
  // On a large schema, `encodeStateAsUpdate` serializes the *entire* doc on
  // the event loop: a slow one here stalls every connected client's WS frame
  // until it returns, not just this project's.
  const state = timeSync("persistence.encodeSnapshot", () => Y.encodeStateAsUpdate(doc));
  await saveSnapshotState(projectId, state);
}

export async function appendRevision(
  projectId: string,
  author: string,
  update: Uint8Array,
  id: string = crypto.randomUUID(),
): Promise<void> {
  // Runs on *every* Yjs update from *every* connected client — dragging a
  // table alone commits one on mouse-up, but a big multi-user session can
  // still fire this several times a second. `seq` is given when the row is
  // inserted, so two appends for one project must not be in flight together:
  // the room sends them one at a time (see `Room.persist`).
  await timeAsync("persistence.appendRevision", () =>
    db
      .prepare(`INSERT INTO revisions (id, project_id, author, yjs_update, created_at) VALUES (?, ?, ?, ?, utc_now())`)
      .run(id, projectId, author, Buffer.from(update)),
  );
}

/** The project's most recent revision, or `null` before its first edit. */
export async function latestRevisionId(projectId: string): Promise<string | null> {
  const row = (await db
    .prepare("SELECT id FROM revisions WHERE project_id = ? ORDER BY seq DESC LIMIT 1")
    .get(projectId)) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Names a revision as a checkpoint (e.g. "v1.0"), or clears the label with `null`. Returns false if no such revision exists for the project. */
export async function setRevisionLabel(projectId: string, revisionId: string, label: string | null): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE revisions SET label = ? WHERE id = ? AND project_id = ?`)
    .run(label, revisionId, projectId);
  return result.changes > 0;
}

export async function listRevisions(projectId: string): Promise<RevisionMeta[]> {
  // `created_at` only has 1s resolution, so a burst of edits within the same
  // second would tie under that ordering. `seq` is the insertion order.
  return (await db
    .prepare(`SELECT id, author, label, created_at AS "createdAt" FROM revisions WHERE project_id = ? ORDER BY seq ASC`)
    .all(projectId)) as RevisionMeta[];
}

/**
 * `listRevisions`, minus entries that made no schema change over the one before them
 * (dragging a table commits a revision on every mouse-up). Restoring any revision still works;
 * only the *list* is filtered. A labeled revision is always kept.
 *
 * "Changed" is `diffProjects`'s notion (tables/fields/refs). Each kept revision carries
 * `changes`, the short form of that diff. Replays the log once into a scratch doc: O(revisions).
 */
export async function listMeaningfulRevisions(projectId: string): Promise<RevisionMeta[]> {
  const rows = (await db
    .prepare(
      `SELECT id, author, label, created_at AS "createdAt", yjs_update FROM revisions WHERE project_id = ? ORDER BY seq ASC`,
    )
    .all(projectId)) as (RevisionMeta & { yjs_update: Buffer })[];

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
async function getRevisionUpdatesUpTo(projectId: string, revisionId: string): Promise<Uint8Array[] | null> {
  const rows = (await db
    .prepare(`SELECT id, yjs_update FROM revisions WHERE project_id = ? ORDER BY seq ASC`)
    .all(projectId)) as { id: string; yjs_update: Buffer }[];
  const idx = rows.findIndex((r) => r.id === revisionId);
  if (idx === -1) return null;
  return rows.slice(0, idx + 1).map((r) => new Uint8Array(r.yjs_update));
}

/** Replays a project's revision log up to `revisionId` into a fresh, disconnected Y.Doc. */
export async function reconstructDocAtRevision(projectId: string, revisionId: string): Promise<Y.Doc | null> {
  const updates = await getRevisionUpdatesUpTo(projectId, revisionId);
  if (!updates) return null;
  const doc = new Y.Doc();
  updates.forEach((update) => Y.applyUpdate(doc, update));
  return doc;
}
