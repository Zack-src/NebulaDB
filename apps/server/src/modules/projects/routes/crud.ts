import type { FastifyInstance } from "fastify";
import { auditUser } from "../../../shared/audit.js";
import { getEffectivePermission } from "../../../shared/permissions.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin, requireUser } from "../../../shared/guards.js";
import { closeRoom } from "../../../realtime/room.js";
import {
  countProjectsOwnedBy,
  deleteProjectCascade,
  getProjectSummary,
  insertProject,
  isProjectStatus,
  listProjectSummaries,
  updateProjectName,
  updateProjectStatus,
} from "../repository.js";

/**
 * Ceiling on projects owned by one account. An abuse backstop in the same
 * spirit as the per-project entity caps in `@athanordb/shared` — generous
 * enough that no real user meets it, low enough that a scripted loop can't
 * fill the disk with empty projects.
 */
const MAX_PROJECTS_PER_USER = 500;
const MAX_PROJECT_NAME_LENGTH = 200;

/** Validates and normalises a submitted project name, throwing the right 400 on failure. */
function parseProjectName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new ApiError("NAME_REQUIRED");
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) throw new ApiError("NAME_TOO_LONG");
  return trimmed;
}

export function registerProjectCrudRoutes(app: FastifyInstance): void {
  app.get("/api/projects", async (req) => {
    const user = requireUser(req);
    return listProjectSummaries()
      .map((row) => ({ ...row, permission: getEffectivePermission(user.id, row.id) }))
      .filter((row) => row.permission !== null);
  });

  app.post("/api/projects", async (req, reply) => {
    const user = requireUser(req);
    const name = parseProjectName((req.body as { name?: unknown } | undefined)?.name);
    // Trashed projects still count — they are recoverable, so they still occupy
    // the quota.
    if (countProjectsOwnedBy(user.id) >= MAX_PROJECTS_PER_USER) {
      throw new ApiError("PROJECT_LIMIT_REACHED", {
        message: `you have reached the limit of ${MAX_PROJECTS_PER_USER} projects`,
        details: { limit: MAX_PROJECTS_PER_USER },
      });
    }
    const id = crypto.randomUUID();
    insertProject(id, name, user.id);
    auditUser(user, "project.create", { type: "project", id }, name, req);
    return reply.code(201).send({ id, name, permission: "administrator" });
  });

  app.get("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAccess(req, id, "view");
    return { ...getProjectSummary(id)!, permission: getEffectivePermission(user.id, id) };
  });

  // Handles both renaming and archive/trash/restore transitions — a project
  // card action only ever changes one or the other, but there's no reason to
  // split them into two endpoints.
  app.patch("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    const { name, status } = (req.body ?? {}) as { name?: string; status?: string };
    if (name === undefined && status === undefined) throw new ApiError("NAME_OR_STATUS_REQUIRED");

    if (name !== undefined) updateProjectName(id, parseProjectName(name));

    if (status !== undefined) {
      if (!isProjectStatus(status)) throw new ApiError("PROJECT_STATUS_INVALID");
      updateProjectStatus(id, status);
      // Only the destructive-ish transitions are worth a row: renames are
      // already visible in the project itself, but "who trashed this?" is a
      // question that gets asked after the fact.
      const action = status === "active" ? "project.restore" : "project.archive";
      auditUser(user, action, { type: "project", id }, `status set to ${status}`, req);
    }

    return { ...getProjectSummary(id)!, permission: "administrator" as const };
  });

  // Permanent delete — the client only calls this from the Trash section
  // ("delete forever"). Moving a project to trash is just a status update via
  // PATCH above, so it can be restored; this one can't be undone.
  app.delete("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAdmin(req, id);
    // Stop the in-memory room (if live) before touching its rows, so a
    // concurrent editor can't write a revision/snapshot for an id that's
    // about to stop existing.
    closeRoom(id);
    deleteProjectCascade(id);
    auditUser(user, "project.delete", { type: "project", id }, project.name, req);
    return { deleted: true };
  });
}
