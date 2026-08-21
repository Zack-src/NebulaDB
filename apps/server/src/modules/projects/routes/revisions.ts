import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { readProjectFromDoc, writeProjectToDoc } from "@athanordb/shared";
import { auditUser } from "../../../shared/audit.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess } from "../../../shared/guards.js";
import {
  listRevisions,
  loadSnapshot,
  reconstructDocAtRevision,
  setRevisionLabel,
} from "../../../realtime/persistence.js";
import { getRoom } from "../../../realtime/roomRegistry.js";

/** Rebuilds the document as it stood at a revision, or refuses with the right 404. */
function loadRevisionDoc(projectId: string, revisionId: string): Y.Doc {
  const doc = reconstructDocAtRevision(projectId, revisionId);
  if (!doc) throw new ApiError("REVISION_NOT_FOUND");
  return doc;
}

export function registerProjectRevisionRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/revisions", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    return listRevisions(id);
  });

  app.patch("/api/projects/:id/revisions/:revisionId", async (req) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    requireProjectAccess(req, id, "edit");
    const { label } = (req.body ?? {}) as { label?: string | null };
    const trimmed = typeof label === "string" ? label.trim() : "";
    if (!setRevisionLabel(id, revisionId, trimmed || null)) throw new ApiError("REVISION_NOT_FOUND");
    return { labeled: true };
  });

  app.get("/api/projects/:id/revisions/:revisionId", async (req) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const { project } = requireProjectAccess(req, id, "view");
    return readProjectFromDoc(loadRevisionDoc(id, revisionId), project.id, project.name);
  });

  app.post("/api/projects/:id/revisions/:revisionId/restore", async (req) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    const restored = readProjectFromDoc(loadRevisionDoc(id, revisionId), project.id, project.name);
    const room = getRoom(id);
    room.doc.transact(() => writeProjectToDoc(room.doc, restored), user.displayName);
    auditUser(user, "project.revision.restore", { type: "project", id }, `revision ${revisionId}`, req);
    return { restored: true };
  });

  app.get("/api/projects/:id/snapshot", async (req) => {
    const { id } = req.params as { id: string };
    const { project } = requireProjectAccess(req, id, "view");
    return readProjectFromDoc(getRoom(id).doc, project.id, project.name);
  });

  app.post("/api/projects/:id/snapshot/restore", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    const snapshot = loadSnapshot(id);
    if (!snapshot) throw new ApiError("SNAPSHOT_NOT_FOUND");

    const snapshotDoc = new Y.Doc();
    Y.applyUpdate(snapshotDoc, snapshot);
    const restored = readProjectFromDoc(snapshotDoc, project.id, project.name);
    const room = getRoom(id);
    room.doc.transact(() => writeProjectToDoc(room.doc, restored), user.displayName);
    return { restored: true };
  });
}
