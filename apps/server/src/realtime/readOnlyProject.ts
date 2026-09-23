import * as Y from "yjs";
import { readProjectFromDoc, type Project } from "@athanordb/shared";
import { db } from "../infrastructure/db.js";
import { loadSnapshot } from "./persistence.js";
import { peekRoom } from "./roomRegistry.js";

/**
 * A project's current content for read-only callers (search, cross-project
 * compare) without side effects: the live room's doc if one is resident —
 * the freshest copy — else the stored snapshot decoded into a throwaway doc.
 * Never `getRoom()`, which would start a room (timers, eviction bookkeeping)
 * just to read it once.
 */
export function readProjectReadOnly(projectId: string, projectName: string): Project {
  const live = peekRoom(projectId);
  if (live) return readProjectFromDoc(live.doc, projectId, projectName);
  return readSnapshotProject(projectId, projectName);
}

/** The project as last snapshotted — even when a live room holds newer, not-yet-snapshotted edits. */
export function readSnapshotProject(projectId: string, projectName: string): Project {
  const doc = new Y.Doc();
  try {
    const state = loadSnapshot(projectId);
    if (state) Y.applyUpdate(doc, state);
    return readProjectFromDoc(doc, projectId, projectName);
  } finally {
    doc.destroy();
  }
}

/** When the stored snapshot last changed — a cheap cache key for anything derived from it. `null` if never saved. */
export function snapshotVersion(projectId: string): string | null {
  const row = db.prepare("SELECT updated_at FROM snapshots WHERE project_id = ?").get(projectId) as
    { updated_at: string } | undefined;
  return row?.updated_at ?? null;
}
