import type { FastifyInstance } from "fastify";
import { parseProjectBundle, readProjectFromDoc, writeProjectToDoc, type Project } from "@nebuladb/shared";
import {
  applyVisualMetadata,
  mergeProjectIntoExisting,
  preserveConcurrentAdditions,
  projectToDbml,
  toProject,
} from "@nebuladb/dbml-engine";
import { auditUser } from "../../../shared/audit.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess } from "../../../shared/guards.js";
import { assertLocksAllow } from "../../tableLocks/access.js";
import { reconstructDocAtRevision } from "../../../realtime/persistence.js";
import { getRoom } from "../../../realtime/roomRegistry.js";
import { readProjectReadOnly } from "../../../realtime/readOnlyProject.js";
import { applyBundle, buildBundle } from "../bundle.js";
import { parseBaselineProject, parseSource, requireSqlDialect, sendSql } from "../dbmlSource.js";

function loadRevisionProject(projectId: string, revisionId: string, name: string): Project {
  const doc = reconstructDocAtRevision(projectId, revisionId);
  if (!doc) throw new ApiError("REVISION_NOT_FOUND");
  return readProjectFromDoc(doc, projectId, name);
}

export function registerProjectImportExportRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/import", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    const body = (req.body ?? {}) as { source?: string; dialect?: string; baseline?: string };
    if (!body.source?.trim()) throw new ApiError("SOURCE_REQUIRED");

    const dialect = body.dialect ? requireSqlDialect(body.dialect) : null;
    const database = parseSource(body.source, dialect);
    const parsed = dialect
      ? toProject(database, project.name, body.source)
      : applyVisualMetadata(toProject(database, project.name, body.source), body.source);

    const room = getRoom(id);
    const current = readProjectFromDoc(room.doc, project.id, project.name);
    // Merge by table/field name rather than a blind overwrite, so reimporting
    // an updated schema keeps existing tables' positions/detail level instead
    // of resetting the whole layout every time.
    const merged = mergeProjectIntoExisting(current, parsed);
    // `baseline` — the text this buffer was generated from — turns the merge
    // above from "the buffer is the whole truth" into a three-way one:
    // anything missing from the buffer *and* from its baseline was added by
    // somebody else while this buffer was open, and must not be deleted by
    // it. Optional: an import with no baseline (the import dialog, a script,
    // an older client) keeps the previous replace-everything behaviour.
    const reconciled = body.baseline?.trim()
      ? preserveConcurrentAdditions(current, merged, parseBaselineProject(body.baseline, project.name))
      : merged;
    assertLocksAllow(user.id, id, current, reconciled);
    room.doc.transact(() => writeProjectToDoc(room.doc, reconciled), user.displayName);
    // An import can restructure an entire schema in one call, which is the
    // kind of change someone later asks "who did that, and when?" about.
    auditUser(user, "project.import", { type: "project", id }, `${reconciled.tables.length} table(s)`, req);
    return { imported: true, tables: reconciled.tables.length };
  });

  app.get("/api/projects/:id/export/dbml", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { visual } = req.query as { visual?: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    const current = readProjectFromDoc(getRoom(id).doc, project.id, project.name);
    // Exports are the exfiltration path for a schema — the one read operation
    // worth recording, since everything else a viewer does leaves the data
    // where it is.
    auditUser(user, "project.export", { type: "project", id }, "dbml", req);
    return reply.type("text/plain").send(projectToDbml(current, { includeVisualMetadata: visual === "1" }));
  });

  // Everything about the project in one file — schema and layout, but also the
  // locks, seeds and generator settings that DBML cannot carry. See `ProjectBundle`.
  app.get("/api/projects/:id/export/bundle", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    const current = readProjectFromDoc(getRoom(id).doc, project.id, project.name);
    auditUser(user, "project.export", { type: "project", id }, "bundle", req);
    return reply.type("application/json").send(JSON.stringify(buildBundle(current), null, 2));
  });

  app.post("/api/projects/:id/import/bundle", { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    const { source } = (req.body ?? {}) as { source?: unknown };
    if (typeof source !== "string" || !source.trim()) throw new ApiError("SOURCE_REQUIRED");
    let bundle;
    try {
      bundle = parseProjectBundle(source);
    } catch (err) {
      throw new ApiError("BUNDLE_INVALID", { message: err instanceof Error ? err.message : undefined });
    }
    const result = applyBundle(user, project, bundle);
    auditUser(
      user,
      "project.import",
      { type: "project", id },
      `bundle: ${result.tables} table(s), ${result.locks} lock(s), ${result.seeds} seed(s)`,
      req,
    );
    return { imported: true, ...result };
  });

  /**
   * The project's current content as JSON — what the cross-project compare
   * diffs against the one open in the editor. Read without starting a room
   * (the compared project usually isn't open anywhere). Audited like the
   * other exports: it hands over the whole schema.
   */
  app.get("/api/projects/:id/content", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    auditUser(user, "project.export", { type: "project", id }, "json (compare)", req);
    return readProjectReadOnly(id, project.name);
  });

  app.get("/api/projects/:id/export/sql", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dialect = requireSqlDialect((req.query as { dialect?: string }).dialect);
    const { user, project } = requireProjectAccess(req, id, "view");
    const current = readProjectFromDoc(getRoom(id).doc, project.id, project.name);
    auditUser(user, "project.export", { type: "project", id }, `sql/${dialect}`, req);
    return sendSql(reply, current, dialect);
  });

  app.get("/api/projects/:id/revisions/:revisionId/export/dbml", async (req, reply) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const { visual } = req.query as { visual?: string };
    const { project } = requireProjectAccess(req, id, "view");
    const historical = loadRevisionProject(id, revisionId, project.name);
    return reply.type("text/plain").send(projectToDbml(historical, { includeVisualMetadata: visual === "1" }));
  });

  app.get("/api/projects/:id/revisions/:revisionId/export/sql", async (req, reply) => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const dialect = requireSqlDialect((req.query as { dialect?: string }).dialect);
    const { project } = requireProjectAccess(req, id, "view");
    return sendSql(reply, loadRevisionProject(id, revisionId, project.name), dialect);
  });
}
