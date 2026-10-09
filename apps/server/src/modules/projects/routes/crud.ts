import type { FastifyInstance } from "fastify";
import { auditUser } from "../../../shared/audit.js";
import { getEffectivePermission } from "../../../shared/permissions.js";
import { requireProjectAccess, requireProjectAdmin, requireUser } from "../../../shared/guards.js";
import { getProjectSummary, listProjectSummaries } from "../repository.js";
import { createProjectForUser, deleteProject, updateProject } from "../projectCrud.js";
import { mapAsync } from "../../../shared/async.js";

export function registerProjectCrudRoutes(app: FastifyInstance): void {
  app.get("/api/projects", async (req) => {
    const user = requireUser(req);
    return (
      await mapAsync(await listProjectSummaries(), async (row) => ({
        ...row,
        permission: await getEffectivePermission(user.id, row.id),
      }))
    ).filter((row) => row.permission !== null);
  });

  app.post("/api/projects", async (req, reply) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as { name?: unknown };
    const { id, name } = await createProjectForUser(user.id, body.name);
    await auditUser(user, "project.create", { type: "project", id }, name, req);
    return reply.code(201).send({ id, name, permission: "administrator" });
  });

  app.get("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "view");
    return { ...(await getProjectSummary(id))!, permission: await getEffectivePermission(user.id, id) };
  });

  // Handles both renaming and archive/trash/restore transitions — a project
  // card action only ever changes one or the other, but there's no reason to
  // split them into two endpoints.
  app.patch("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    const { name, status } = (req.body ?? {}) as { name?: string; status?: string };
    const changed = await updateProject(id, { name, status });

    if (changed.status !== undefined) {
      // Only the destructive-ish transitions are worth a row: renames are
      // already visible in the project itself, but "who trashed this?" is a
      // question that gets asked after the fact.
      const action = changed.status === "active" ? "project.restore" : "project.archive";
      await auditUser(user, action, { type: "project", id }, `status set to ${changed.status}`, req);
    }

    return { ...(await getProjectSummary(id))!, permission: "administrator" as const };
  });

  // Permanent delete — the client only calls this from the Trash section
  // ("delete forever"). Moving a project to trash is just a status update via
  // PATCH above, so it can be restored; this one can't be undone.
  app.delete("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = await requireProjectAdmin(req, id);
    await deleteProject(id);
    await auditUser(user, "project.delete", { type: "project", id }, project.name, req);
    return { deleted: true };
  });
}
