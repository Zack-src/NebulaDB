import type { FastifyInstance } from "fastify";
import { projectToDbml } from "@nebuladb/dbml-engine";
import { readProjectFromDoc, SEED_MODES, SEED_SEPARATORS } from "@nebuladb/shared";
import { requireScope, requireScopeOn } from "../apiKeys/auth.js";
import { labelRevision, projectAtRevision, restoreRevision } from "../projects/routes/revisions.js";
import {
  parseTargets,
  pushVariantsAndAudit,
  resetVariantAndAudit,
  variantsOf,
} from "../projects/routes/foldersVariants.js";
import { compareProjects, familyOf, getVariantLink, previewSync } from "../projects/variants.js";
import { parseSyncOptions } from "../projects/routes/foldersVariants.js";
import { readTableSeed, removeTableSeed, setInlineSeed } from "../seeds/routes.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { idParams, paramsOf, parseParams } from "../../shared/validate.js";
import { API_RATE_LIMIT } from "./rateLimits.js";
import { findTable, requireTable } from "./tableRef.js";

const revisionParams = paramsOf("id", "revisionId");
const otherParams = paramsOf("id", "otherId");
const tableParams = paramsOf("id", "table");

/**
 * History, variants and seeds under `/api/v1` — the same functions as the app's history panel,
 * variants panel and seed dialog (`projects/routes/revisions.ts`, `foldersVariants.ts`,
 * `seeds/routes.ts`), so a script or an AI agent goes through the same checks: `edit` to write,
 * table locks, and on a variant push `edit` on every receiving project. What creates a project
 * (forking a revision, starting a variant) or administers one (detaching a variant) stays off.
 *
 * A key restricted to one project touches that one only: a variant operation naming another
 * project is refused for it (`requireScopeOn`).
 */
export function registerPublicHistoryVariantSeedRoutes(app: FastifyInstance): void {
  // ---- history ---------------------------------------------------------

  app.get("/api/v1/projects/:id/revisions/:revisionId/export/dbml", API_RATE_LIMIT, async (req, reply) => {
    const { id, revisionId } = parseParams(revisionParams, req);
    const { user, project } = await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    const revision = await projectAtRevision(project, revisionId);
    await auditUser(user, "project.export", { type: "project", id }, `dbml of revision ${revisionId} (v1)`, req);
    return reply.type("text/plain").send(projectToDbml(revision));
  });

  app.patch("/api/v1/projects/:id/revisions/:revisionId", API_RATE_LIMIT, async (req) => {
    const { id, revisionId } = parseParams(revisionParams, req);
    await requireProjectAccess(req, id, "edit");
    requireScope(req, "projects:write", id);
    await labelRevision(id, revisionId, (req.body as { label?: unknown } | null)?.label);
    return { labeled: true };
  });

  // `tables`: only these (ids or names, as the revision or the project has them); the rest stays as it is now.
  app.post("/api/v1/projects/:id/revisions/:revisionId/restore", API_RATE_LIMIT, async (req) => {
    const { id, revisionId } = parseParams(revisionParams, req);
    const { user, project } = await requireProjectAccess(req, id, "edit");
    requireScope(req, "projects:write", id);
    const tables = (req.body as { tables?: unknown } | null)?.tables;
    let tableIds: unknown = undefined;
    if (tables !== undefined && tables !== null) {
      if (!Array.isArray(tables) || !tables.every((t) => typeof t === "string"))
        throw new ApiError("RESTORE_TABLES_INVALID");
      const revision = await projectAtRevision(project, revisionId);
      const current = readProjectFromDoc((await getRoom(id)).doc, project.id, project.name);
      tableIds = (tables as string[]).map((ref) => {
        const table = findTable(revision.tables, ref) ?? findTable(current.tables, ref);
        if (!table)
          throw new ApiError("TABLE_NOT_FOUND", { message: `no table "${ref}" in the revision or the project` });
        return table.id;
      });
    }
    await restoreRevision(req, user, project, revisionId, tableIds);
    return { restored: true };
  });

  // ---- variants --------------------------------------------------------

  app.get("/api/v1/projects/:id/variants", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return await variantsOf(user, id);
  });

  app.get("/api/v1/projects/:id/family", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return { family: await familyOf(user.id, id) };
  });

  app.get("/api/v1/projects/:id/compare/:otherId", API_RATE_LIMIT, async (req) => {
    const { id, otherId } = parseParams(otherParams, req);
    const { user } = await requireProjectAccess(req, id, "view");
    await requireProjectAccess(req, otherId, "view");
    requireScopeOn(req, "projects:read", [id, otherId]);
    await auditUser(user, "project.export", { type: "project", id: otherId }, `compare with ${id} (v1)`, req);
    return { diff: await compareProjects(id, otherId) };
  });

  app.post("/api/v1/projects/:id/variants/preview", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAccess(req, id, "view");
    const body = (req.body ?? {}) as { variants?: unknown; direction?: unknown; ignoreFieldProps?: unknown };
    const targets = parseTargets(body.variants).map((t) => t.id);
    requireScopeOn(req, "projects:read", [id, ...targets]);
    return { variants: await previewSync(user.id, id, targets, parseSyncOptions(body)) };
  });

  app.post("/api/v1/projects/:id/variants/push", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user, project } = await requireProjectAccess(req, id, "view");
    const body = (req.body ?? {}) as { variants?: unknown; direction?: unknown; ignoreFieldProps?: unknown };
    requireScopeOn(req, "projects:write", [id, ...parseTargets(body.variants).map((t) => t.id)]);
    return { results: await pushVariantsAndAudit(req, user, project, body) };
  });

  // `from`: "original", or the id of another variant of the same original.
  app.post("/api/v1/projects/:id/variant/reset", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAccess(req, id, "edit");
    const from = (req.body as { from?: unknown } | null)?.from;
    const source = from === "original" ? (await getVariantLink(id))?.baseProjectId : from;
    requireScopeOn(req, "projects:write", [id, ...(typeof source === "string" && source ? [source] : [])]);
    return { reset: true, from: await resetVariantAndAudit(req, user, id, from) };
  });

  // ---- seeds -----------------------------------------------------------

  app.get("/api/v1/projects/:id/seeds/:table", API_RATE_LIMIT, async (req) => {
    const { id, table } = parseParams(tableParams, req);
    const { project } = await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    const resolved = await requireTable(id, project.name, table);
    return { seed: await readTableSeed(id, resolved.id) };
  });

  /**
   * `{ content, options? }` — the CSV and how to read it. Without `options.mapping` the first line
   * names the columns (`header` true by default) and is matched to the table's columns by name; a
   * column the table does not have is ignored. `separator` defaults to `,`, `mode` to `if-empty`.
   */
  app.put("/api/v1/projects/:id/seeds/:table", { ...API_RATE_LIMIT, bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const { id, table } = parseParams(tableParams, req);
    const { user, project } = await requireProjectAccess(req, id, "edit");
    requireScope(req, "projects:write", id);
    const resolved = await requireTable(id, project.name, table);
    const body = (req.body ?? {}) as { content?: unknown; options?: Record<string, unknown> };
    const given = body.options ?? {};
    const separator = given.separator ?? ",";
    const header = given.header ?? true;
    let mapping = given.mapping;
    if (mapping === undefined && header === true && typeof body.content === "string") {
      if (!SEED_SEPARATORS.includes(separator as never)) throw new ApiError("SEED_INVALID");
      const firstLine = body.content.split(/\r?\n/, 1)[0] ?? "";
      const columns = new Map(resolved.fields.map((f) => [f.name.toLowerCase(), f.id]));
      mapping = firstLine
        .split(separator as string)
        .map((name) => columns.get(name.trim().replace(/^"|"$/g, "").toLowerCase()) ?? null);
    } else if (Array.isArray(mapping)) {
      // Column names are accepted where the seed dialog stores field ids.
      mapping = mapping.map((m) =>
        typeof m === "string"
          ? (resolved.fields.find((f) => f.id === m || f.name.toLowerCase() === m.toLowerCase())?.id ?? null)
          : null,
      );
    }
    const options = { separator, header, mode: given.mode ?? SEED_MODES[0], mapping };
    return { seed: await setInlineSeed(req, user, project, resolved.id, { content: body.content, options }) };
  });

  app.delete("/api/v1/projects/:id/seeds/:table", API_RATE_LIMIT, async (req) => {
    const { id, table } = parseParams(tableParams, req);
    const { user, project } = await requireProjectAccess(req, id, "edit");
    requireScope(req, "projects:write", id);
    const resolved = await requireTable(id, project.name, table);
    await removeTableSeed(req, user, project, resolved.id);
    return { deleted: true };
  });
}
