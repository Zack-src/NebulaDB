import type { FastifyInstance } from "fastify";
import { readProjectFromDoc, writeProjectToDoc } from "@nebuladb/shared";
import {
  applyVisualMetadata,
  buildDictionary,
  dictionaryToCsv,
  dictionaryToHtml,
  dictionaryToMarkdown,
  type DataDictionary,
  mergeProjectIntoExisting,
  preserveConcurrentAdditions,
  projectToDbml,
  projectToSvg,
  toProject,
} from "@nebuladb/dbml-engine";
import { assertLocksAllow } from "../tableLocks/access.js";
import { lintReport } from "../lint/check.js";
import { requireScope } from "../apiKeys/auth.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin, requireUser } from "../../shared/guards.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { listRevisions } from "../../realtime/persistence.js";
import { getEffectivePermission } from "../../shared/permissions.js";
import { svgToPng } from "../../shared/svgToPng.js";
import { getProjectSummary, listProjectSummaries } from "../projects/repository.js";
import { createProjectForUser, deleteProject, updateProject } from "../projects/projectCrud.js";
import { parseBaselineProject, parseSource, requireSqlDialect, sendSql } from "../projects/dbmlSource.js";
import { registerPublicBackupRoutes } from "./backupRoutes.js";
import { registerPublicCredentialRoutes } from "./credentialRoutes.js";
import { registerPublicIamRoutes } from "./iamRoutes.js";
import { registerPublicLockRoutes } from "./lockRoutes.js";
import { registerPublicMonitoringRoutes } from "./monitoringRoutes.js";
import { registerPublicConnectionRoutes } from "./connectionRoutes.js";
import { registerPublicTeamRoutes } from "./teamRoutes.js";
import { registerPublicWebhookRoutes } from "./webhookRoutes.js";
import { API_RATE_LIMIT } from "./rateLimits.js";
import { buildOpenApiSpec } from "./openapi.js";
import { config } from "../../config.js";

const DICTIONARY_FORMATS: Record<string, { type: string; body: (dictionary: DataDictionary) => string }> = {
  json: { type: "application/json", body: (dictionary) => JSON.stringify(dictionary) },
  markdown: { type: "text/markdown", body: dictionaryToMarkdown },
  csv: { type: "text/csv", body: dictionaryToCsv },
  html: { type: "text/html", body: dictionaryToHtml },
};

/**
 * The stable, versioned, key-authable public surface (Phase 21). Deliberately
 * separate from `/api/projects/*` (the internal, session-only, web-app
 * surface) even though several handlers here are thin wrappers over the same
 * `dbml-engine`/repository functions those routes use — `/api/v1` is a
 * contract external callers depend on, so it shouldn't move just because the
 * app's own internal routes do.
 *
 * Every route runs through the normal `requireProjectAccess`/
 * `requireProjectAdmin`/`requireAdmin` permission checks unchanged (an API
 * key authenticates *as* its owning user — see `apiKeys/auth.ts`) plus
 * `requireScope`/`requireGlobalScope`, which are no-ops for a
 * cookie-authenticated request and only narrow what a key can do beyond
 * that. Split across this file (project CRUD/export/import/history) and
 * `iamRoutes.ts`, `connectionRoutes.ts`, `teamRoutes.ts` — the same
 * per-resource split `modules/projects/index.ts` already uses for the
 * internal routes.
 */
export function registerPublicApiRoutes(app: FastifyInstance): void {
  /**
   * The machine-readable description of everything below — public, no key
   * needed: it documents routes, not data, and tools (Postman, client
   * generators, Swagger UI) need to fetch it before they have a key.
   */
  app.get("/api/v1/openapi.json", API_RATE_LIMIT, async () =>
    buildOpenApiSpec(config.publicUrl ? `${config.publicUrl}` : null),
  );

  app.get("/api/v1/projects", API_RATE_LIMIT, async (req) => {
    const user = requireUser(req);
    requireScope(req, "projects:read");
    return {
      projects: listProjectSummaries()
        .map((row) => ({ ...row, permission: getEffectivePermission(user.id, row.id) }))
        .filter((row) => row.permission !== null),
    };
  });

  app.post("/api/v1/projects", API_RATE_LIMIT, async (req, reply) => {
    const user = requireUser(req);
    requireScope(req, "projects:write");
    const body = (req.body ?? {}) as { name?: unknown };
    const { id, name } = createProjectForUser(user.id, body.name);
    auditUser(user, "project.create", { type: "project", id }, `${name} (v1)`, req);
    return reply.code(201).send({ id, name, permission: "administrator" });
  });

  app.get("/api/v1/projects/:id", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { project, user } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return { id: project.id, name: project.name, permission: getEffectivePermission(user.id, id) };
  });

  // Renaming and archive/trash/restore transitions, same as the internal `/api/projects/:id` route.
  app.patch("/api/v1/projects/:id", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    const { name, status } = (req.body ?? {}) as { name?: string; status?: string };
    const changed = updateProject(id, { name, status });

    if (changed.status !== undefined) {
      const action = changed.status === "active" ? "project.restore" : "project.archive";
      auditUser(user, action, { type: "project", id }, `status set to ${changed.status} (v1)`, req);
    }

    return { ...getProjectSummary(id)!, permission: "administrator" as const };
  });

  // Permanent delete — irreversible. Moving to trash is the PATCH above (`status: "trashed"`), which can be restored.
  app.delete("/api/v1/projects/:id", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    deleteProject(id);
    auditUser(user, "project.delete", { type: "project", id }, `${project.name} (v1)`, req);
    return { deleted: true };
  });

  app.get("/api/v1/projects/:id/history", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return { revisions: listRevisions(id) };
  });

  // What the schema linter finds, with the project's own rules — the same findings as the editor's problems panel.
  app.get("/api/v1/projects/:id/lint", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return lintReport(id, project.name);
  });

  // The data dictionary — what the schema's notes say each table and column is — as JSON or as a document.
  app.get("/api/v1/projects/:id/dictionary", API_RATE_LIMIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const format = (req.query as { format?: string }).format ?? "json";
    const { project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    const render = DICTIONARY_FORMATS[format];
    if (!render) throw new ApiError("DICTIONARY_FORMAT_INVALID");
    const dictionary = buildDictionary(readProjectFromDoc(getRoom(id).doc, project.id, project.name));
    if (format === "json") return dictionary;
    return reply.type(`${render.type}; charset=utf-8`).send(render.body(dictionary));
  });

  app.get("/api/v1/projects/:id/export/dbml", API_RATE_LIMIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { visual } = req.query as { visual?: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    const current = readProjectFromDoc(getRoom(id).doc, project.id, project.name);
    auditUser(user, "project.export", { type: "project", id }, "dbml (v1)", req);
    return reply.type("text/plain").send(projectToDbml(current, { includeVisualMetadata: visual === "1" }));
  });

  app.get("/api/v1/projects/:id/export/sql", API_RATE_LIMIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dialect = requireSqlDialect((req.query as { dialect?: string }).dialect);
    const { user, project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    const current = readProjectFromDoc(getRoom(id).doc, project.id, project.name);
    auditUser(user, "project.export", { type: "project", id }, `sql/${dialect} (v1)`, req);
    return sendSql(reply, current, dialect);
  });

  app.get("/api/v1/projects/:id/export/svg", API_RATE_LIMIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    const current = readProjectFromDoc(getRoom(id).doc, project.id, project.name);
    auditUser(user, "project.export", { type: "project", id }, "svg (v1)", req);
    return reply.type("image/svg+xml").send(projectToSvg(current));
  });

  app.get("/api/v1/projects/:id/export/png", API_RATE_LIMIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    const current = readProjectFromDoc(getRoom(id).doc, project.id, project.name);
    auditUser(user, "project.export", { type: "project", id }, "png (v1)", req);
    const png = await svgToPng(projectToSvg(current));
    return reply.type("image/png").send(png);
  });

  app.post("/api/v1/projects/:id/import", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    requireScope(req, "projects:write", id);
    const body = (req.body ?? {}) as { source?: string; dialect?: string; baseline?: string };
    if (!body.source?.trim()) throw new ApiError("SOURCE_REQUIRED");

    const dialect = body.dialect ? requireSqlDialect(body.dialect) : null;
    const database = parseSource(body.source, dialect);
    const parsed = dialect
      ? toProject(database, project.name, body.source)
      : applyVisualMetadata(toProject(database, project.name, body.source), body.source);

    const room = getRoom(id);
    const current = readProjectFromDoc(room.doc, project.id, project.name);
    const merged = mergeProjectIntoExisting(current, parsed);
    const reconciled = body.baseline?.trim()
      ? preserveConcurrentAdditions(current, merged, parseBaselineProject(body.baseline, project.name))
      : merged;
    assertLocksAllow(user.id, id, current, reconciled);
    room.doc.transact(() => writeProjectToDoc(room.doc, reconciled), user.displayName);
    auditUser(user, "project.import", { type: "project", id }, `${reconciled.tables.length} table(s) (v1)`, req);
    return { imported: true, tables: reconciled.tables.length };
  });

  registerPublicIamRoutes(app);
  registerPublicLockRoutes(app);
  registerPublicMonitoringRoutes(app);
  registerPublicConnectionRoutes(app);
  registerPublicCredentialRoutes(app);
  registerPublicBackupRoutes(app);
  registerPublicWebhookRoutes(app);
  registerPublicTeamRoutes(app);
}
