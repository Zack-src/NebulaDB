import type { FastifyInstance } from "fastify";
import { projectToDbml } from "@nebuladb/dbml-engine";
import { buildProjectPreview } from "@nebuladb/shared";
import { auditUser } from "../../../shared/audit.js";
import { getEffectivePermission, getEffectivePermissions } from "../../../shared/permissions.js";
import { requireProjectAccess, requireProjectAdmin, requireUser } from "../../../shared/guards.js";
import { getProjectSummary, listProjectSummaries } from "../repository.js";
import { createProjectForUser, deleteProject, updateProject } from "../projectCrud.js";
import { readProjectReadOnly } from "../../../realtime/readOnlyProject.js";
import { idParams, parseBody, parseParams, parseQuery, z } from "../../../shared/validate.js";

const listQuery = z.object({ limit: z.string().optional(), offset: z.string().optional() });
/** Values stay `unknown`: `parseProjectName` / `updateProject` own the value rules and their specific error codes. */
const createBody = z.object({ name: z.unknown().optional() });
const patchBody = z.object({ name: z.unknown().optional(), status: z.unknown().optional() });

export function registerProjectCrudRoutes(app: FastifyInstance): void {
  app.get("/api/projects", async (req) => {
    const user = requireUser(req);
    const permissions = await getEffectivePermissions(user.id, user.isAdmin);
    const visible = (await listProjectSummaries())
      .map((row) => ({ ...row, permission: permissions.get(row.id) ?? null }))
      .filter((row) => row.permission !== null);

    // Optional paging: without `limit` the whole list comes back exactly as
    // before, so the web app (which sends neither) is unaffected.
    const { limit, offset } = parseQuery(listQuery, req);
    const lim = Number.parseInt(limit ?? "", 10);
    if (!Number.isFinite(lim) || lim < 1) return visible;
    const off = Math.max(0, Number.parseInt(offset ?? "", 10) || 0);
    return visible.slice(off, off + Math.min(lim, 500));
  });

  app.post("/api/projects", async (req, reply) => {
    const user = requireUser(req);
    const body = parseBody(createBody, req);
    const { id, name } = await createProjectForUser(user.id, body.name);
    await auditUser(user, "project.create", { type: "project", id }, name, req);
    return reply.code(201).send({ id, name, permission: "administrator" });
  });

  app.get("/api/projects/:id", async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAccess(req, id, "view");
    return { ...(await getProjectSummary(id))!, permission: await getEffectivePermission(user.id, id) };
  });

  /**
   * A light picture of the project for the page to paint while the editor loads: the first lines of its DBML and a
   * box per table and a line per relation (`ProjectPreview`). Read from the live document, so it is as fresh as the
   * editor will be.
   */
  app.get("/api/projects/:id/preview", async (req, reply) => {
    const { id } = parseParams(idParams, req);
    await requireProjectAccess(req, id, "view");
    const summary = (await getProjectSummary(id))!;
    const project = await readProjectReadOnly(id, summary.name);
    reply.header("Cache-Control", "no-store");
    return buildProjectPreview(project, projectToDbml(project));
  });

  // Handles both renaming and archive/trash/restore transitions — a project
  // card action only ever changes one or the other, but there's no reason to
  // split them into two endpoints.
  app.patch("/api/projects/:id", async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAdmin(req, id);
    const { name, status } = parseBody(patchBody, req);
    const changed = await updateProject(id, { name, status });

    if (changed.status !== undefined) {
      // Only the destructive-ish transitions are worth a row: renames are
      // already visible in the project itself, but "who trashed this?" is a
      // question that gets asked after the fact.
      const action = changed.status === "active" ? "project.restore" : "project.archive";
      const detached = changed.detachedConnections ? `, detached from ${changed.detachedConnections.join(", ")}` : "";
      await auditUser(user, action, { type: "project", id }, `status set to ${changed.status}${detached}`, req);
    }

    return {
      ...(await getProjectSummary(id))!,
      permission: "administrator" as const,
      ...(changed.detachedConnections && { detachedConnections: changed.detachedConnections }),
    };
  });

  // Permanent delete — the client only calls this from the Trash section
  // ("delete forever"). Moving a project to trash is just a status update via
  // PATCH above, so it can be restored; this one can't be undone.
  app.delete("/api/projects/:id", async (req) => {
    const { id } = parseParams(idParams, req);
    const { user, project } = await requireProjectAdmin(req, id);
    await deleteProject(id);
    await auditUser(user, "project.delete", { type: "project", id }, project.name, req);
    return { deleted: true };
  });
}
