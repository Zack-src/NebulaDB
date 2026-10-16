import type { FastifyInstance } from "fastify";
import type { VariantDecisions } from "@nebuladb/dbml-engine";
import { auditUser } from "../../../shared/audit.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin, requireUser } from "../../../shared/guards.js";
import { getEffectivePermission } from "../../../shared/permissions.js";
import { mapAsync } from "../../../shared/async.js";
import {
  createFolder,
  deleteFolder,
  getFolder,
  listVisibleFolders,
  mayManageFolder,
  setProjectFolder,
  updateFolder,
} from "../folders.js";
import { getProjectRow, listProjectSummaries } from "../repository.js";
import {
  compareProjects,
  createVariant,
  detachVariant,
  getVariantLink,
  listVariants,
  previewSync,
  pushToVariants,
  statusOf,
} from "../variants.js";

const MAX_TARGETS = 100;

function parseTargets(raw: unknown): { id: string; decisions?: VariantDecisions }[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TARGETS)
    throw new ApiError("VARIANT_TARGETS_INVALID");
  return raw.map((entry) => {
    const id = typeof entry === "string" ? entry : (entry as { id?: unknown })?.id;
    if (typeof id !== "string") throw new ApiError("VARIANT_TARGETS_INVALID");
    const decisions: VariantDecisions = {};
    const sent = typeof entry === "object" ? (entry as { decisions?: unknown }).decisions : undefined;
    if (sent !== undefined) {
      if (!sent || typeof sent !== "object") throw new ApiError("VARIANT_TARGETS_INVALID");
      for (const [key, value] of Object.entries(sent)) {
        if (value !== "base" && value !== "variant") throw new ApiError("VARIANT_TARGETS_INVALID");
        decisions[key] = value;
      }
    }
    return { id, decisions };
  });
}

export function registerFolderAndVariantRoutes(app: FastifyInstance): void {
  // ---- folders ----------------------------------------------------------

  app.get("/api/project-folders", async (req) => {
    const user = requireUser(req);
    const visible = (
      await mapAsync(await listProjectSummaries(), async (row) =>
        (await getEffectivePermission(user.id, row.id)) ? [row.folderId] : [],
      )
    ).flat();
    return { folders: await listVisibleFolders(user, visible) };
  });

  app.post("/api/project-folders", async (req, reply) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as { name?: unknown; parentId?: unknown };
    const folder = await createFolder(user.id, body);
    await auditUser(user, "folder.create", { type: "folder", id: folder.id }, folder.name, req);
    return reply.code(201).send({ folder });
  });

  app.patch("/api/project-folders/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const folder = await getFolder(id);
    if (!folder) throw new ApiError("FOLDER_NOT_FOUND");
    if (!mayManageFolder(user, folder)) throw new ApiError("FOLDER_FORBIDDEN");
    const updated = await updateFolder(id, (req.body ?? {}) as { name?: unknown; parentId?: unknown });
    await auditUser(user, "folder.update", { type: "folder", id }, updated.name, req);
    return { folder: updated };
  });

  app.delete("/api/project-folders/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const folder = await getFolder(id);
    if (!folder) throw new ApiError("FOLDER_NOT_FOUND");
    if (!mayManageFolder(user, folder)) throw new ApiError("FOLDER_FORBIDDEN");
    const moved = await deleteFolder(id);
    await auditUser(user, "folder.delete", { type: "folder", id }, folder.name, req);
    return { deleted: true, ...moved };
  });

  app.put("/api/projects/:id/folder", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    const folderId = await setProjectFolder(id, (req.body as { folderId?: unknown } | undefined)?.folderId ?? null);
    await auditUser(user, "project.folder", { type: "project", id }, folderId ?? "top", req);
    return { folderId };
  });

  // ---- variants ---------------------------------------------------------

  // Copying is reading: whoever may export the original may start a variant of it, as a project of their own.
  app.post("/api/projects/:id/variants", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user, project } = await requireProjectAccess(req, id, "view");
    const created = await createVariant(user, id, (req.body as { name?: unknown } | undefined)?.name);
    await auditUser(user, "project.variant.create", { type: "project", id: created.id }, `of ${project.name}`, req);
    return reply.code(201).send({ ...created, permission: "administrator", variantOf: id });
  });

  /** For an original: its variants. For a variant: its original and how far behind it is. Both can be true of neither. */
  app.get("/api/projects/:id/variants", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "view");
    const link = await getVariantLink(id);
    if (link) {
      const canSeeBase = await getEffectivePermission(user.id, link.baseProjectId);
      return {
        variants: [],
        original: {
          id: link.baseProjectId,
          name: canSeeBase ? ((await getProjectRow(link.baseProjectId))?.name ?? null) : null,
          canView: Boolean(canSeeBase),
          syncedAt: link.syncedAt,
          syncedByName: link.syncedByName,
          status: await statusOf(id),
        },
      };
    }
    return { variants: await listVariants(user.id, id), original: null };
  });

  app.post("/api/projects/:id/variants/preview", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "view");
    const targets = parseTargets((req.body as { variants?: unknown } | undefined)?.variants);
    return {
      variants: await previewSync(
        user.id,
        id,
        targets.map((t) => t.id),
      ),
    };
  });

  app.post("/api/projects/:id/variants/push", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = await requireProjectAccess(req, id, "view");
    const targets = parseTargets((req.body as { variants?: unknown } | undefined)?.variants);
    const results = await pushToVariants(user, id, targets);
    for (const result of results.filter((r) => !r.error)) {
      await auditUser(
        user,
        "project.variant.push",
        { type: "project", id: result.id },
        `from ${project.name}: ${result.applied} change(s) taken, ${result.kept} kept`,
        req,
      );
    }
    return { results };
  });

  app.delete("/api/projects/:id/variant", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    if (!(await detachVariant(id))) throw new ApiError("VARIANT_NOT_FOUND");
    await auditUser(user, "project.variant.detach", { type: "project", id }, undefined, req);
    return { detached: true };
  });

  /** `:id` against `:otherId`: what `:otherId` has differently, matched by id (meaningful between an original and its variants). */
  app.get("/api/projects/:id/compare/:otherId", async (req) => {
    const { id, otherId } = req.params as { id: string; otherId: string };
    const { user } = await requireProjectAccess(req, id, "view");
    await requireProjectAccess(req, otherId, "view");
    await auditUser(user, "project.export", { type: "project", id: otherId }, `compare with ${id}`, req);
    return { diff: await compareProjects(id, otherId) };
  });
}
