import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { readProjectFromDoc, writeProjectToDoc } from "@nebuladb/shared";
import { restoreTables } from "@nebuladb/dbml-engine";
import { auditUser } from "../../../shared/audit.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess } from "../../../shared/guards.js";
import { canManageProject } from "../../../shared/permissions.js";
import {
  listMeaningfulRevisions,
  loadSnapshot,
  reconstructDocAtRevision,
  setRevisionLabel,
} from "../../../realtime/persistence.js";
import { getRoom } from "../../../realtime/roomRegistry.js";
import { lockGuardFor } from "../../tableLocks/access.js";
import { listHistoryMarkers, restoreAuditDetail } from "../historyMarkers.js";

/** More table ids than any partial restore needs; the cap only keeps the request bounded. */
const MAX_RESTORE_TABLES = 500;

/** `tableIds` of a restore body: absent for a whole restore, else a non-empty list of strings. */
function parseRestoreTableIds(body: unknown): string[] | null {
  const tableIds = (body as { tableIds?: unknown } | null | undefined)?.tableIds;
  if (tableIds === undefined || tableIds === null) return null;
  if (
    !Array.isArray(tableIds) ||
    tableIds.length === 0 ||
    tableIds.length > MAX_RESTORE_TABLES ||
    !tableIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)
  ) {
    throw new ApiError("RESTORE_TABLES_INVALID");
  }
  return [...new Set(tableIds as string[])];
}

/** Rebuilds the document as it stood at a revision, or refuses with the right 404. */
async function loadRevisionDoc(projectId: string, revisionId: string): Promise<Y.Doc> {
  const doc = await reconstructDocAtRevision(projectId, revisionId);
  if (!doc) throw new ApiError("REVISION_NOT_FOUND");
  return doc;
}

export function registerProjectRevisionRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/revisions", async (req) => {
    const { id } = req.params as { id: string };
    await requireProjectAccess(req, id, "view");
    return await listMeaningfulRevisions(id);
  });

  // Locks, restores and (for project administrators) deployments, to place on the timeline.
  app.get("/api/projects/:id/history/markers", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "view");
    return await listHistoryMarkers(id, await canManageProject(user.id, id));
  });

  app.patch("/api/projects/:id/revisions/:revisionId", async (req) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    await requireProjectAccess(req, id, "edit");
    const { label } = (req.body ?? {}) as { label?: string | null };
    const trimmed = typeof label === "string" ? label.trim() : "";
    if (!(await setRevisionLabel(id, revisionId, trimmed || null))) throw new ApiError("REVISION_NOT_FOUND");
    return { labeled: true };
  });

  app.get("/api/projects/:id/revisions/:revisionId", async (req) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const { project } = await requireProjectAccess(req, id, "view");
    return readProjectFromDoc(await loadRevisionDoc(id, revisionId), project.id, project.name);
  });

  app.post("/api/projects/:id/revisions/:revisionId/restore", async (req) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const { user, project } = await requireProjectAccess(req, id, "edit");
    const tableIds = parseRestoreTableIds(req.body);
    const revision = readProjectFromDoc(await loadRevisionDoc(id, revisionId), project.id, project.name);
    const assertLocksAllow = await lockGuardFor(user.id, id);
    // From here to `room.write`, nothing waits: see `Room.write`.
    const room = await getRoom(id);
    const current = readProjectFromDoc(room.doc, project.id, project.name);
    // `tableIds`: "restore only these tables" — the rest of the project stays as it is now.
    const restored = tableIds ? restoreTables(current, revision, tableIds) : revision;
    // History is not a way around a lock: a restore that would change a
    // locked table is refused like any other write.
    assertLocksAllow(current, restored);
    const lastBefore = room.lastRevisionId;
    const written = room.write(() => writeProjectToDoc(room.doc, restored), user.displayName);
    // The revision the restore wrote (none when nothing differed) — lets the
    // timeline put the restore exactly before the state it produced. Read
    // before waiting, so it is this change's and not a later one's.
    const produced = room.lastRevisionId;
    await written;
    const tableNames = tableIds?.map(
      (tableId) =>
        (revision.tables.find((t) => t.id === tableId) ?? current.tables.find((t) => t.id === tableId))?.name ??
        tableId,
    );
    await auditUser(
      user,
      "project.revision.restore",
      { type: "project", id },
      restoreAuditDetail(revisionId, produced !== lastBefore ? produced : null, tableNames),
      req,
    );
    return { restored: true };
  });

  app.get("/api/projects/:id/snapshot", async (req) => {
    const { id } = req.params as { id: string };
    const { project } = await requireProjectAccess(req, id, "view");
    return readProjectFromDoc((await getRoom(id)).doc, project.id, project.name);
  });

  app.post("/api/projects/:id/snapshot/restore", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = await requireProjectAccess(req, id, "edit");
    const snapshot = await loadSnapshot(id);
    if (!snapshot) throw new ApiError("SNAPSHOT_NOT_FOUND");

    const snapshotDoc = new Y.Doc();
    Y.applyUpdate(snapshotDoc, snapshot);
    const restored = readProjectFromDoc(snapshotDoc, project.id, project.name);
    const assertLocksAllow = await lockGuardFor(user.id, id);
    const room = await getRoom(id);
    assertLocksAllow(readProjectFromDoc(room.doc, project.id, project.name), restored);
    await room.write(() => writeProjectToDoc(room.doc, restored), user.displayName);
    return { restored: true };
  });
}
