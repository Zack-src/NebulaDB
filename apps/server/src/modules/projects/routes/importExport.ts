import type { FastifyInstance, FastifyReply } from "fastify";
import { readProjectFromDoc, writeProjectToDoc, type Project } from "@athanordb/shared";
import {
  applyVisualMetadata,
  describeDbmlParseError,
  mergeProjectIntoExisting,
  parseDbml,
  parseSql,
  projectToDbml,
  projectToSql,
  toProject,
  type SqlDialect,
} from "@athanordb/dbml-engine";
import { auditUser } from "../../../shared/audit.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess } from "../../../shared/guards.js";
import { isSqlDialect, SQL_DIALECTS } from "../../../shared/sqlDialect.js";
import { reconstructDocAtRevision } from "../../../realtime/persistence.js";
import { getRoom } from "../../../realtime/room.js";

function requireSqlDialect(value: unknown): SqlDialect {
  if (!isSqlDialect(value)) {
    throw new ApiError("SQL_DIALECT_INVALID", { message: `dialect must be one of ${SQL_DIALECTS.join(", ")}` });
  }
  return value;
}

/**
 * Parses submitted source into a `Database`, translating the engine's own
 * diagnostic into a 400 that keeps its line/column so the editor can place a
 * marker on the offending line.
 */
function parseSource(source: string, dialect: SqlDialect | null) {
  try {
    return dialect ? parseSql(source, dialect) : parseDbml(source);
  } catch (err) {
    const info = describeDbmlParseError(err);
    throw new ApiError(dialect ? "SQL_PARSE_FAILED" : "DBML_PARSE_FAILED", {
      message: `${dialect ? "SQL" : "DBML"} parse error: ${info.message}`,
      details: info as unknown as Record<string, unknown>,
    });
  }
}

function sendSql(reply: FastifyReply, project: Project, dialect: SqlDialect) {
  try {
    return reply.type("text/plain").send(projectToSql(project, dialect));
  } catch (err) {
    throw new ApiError("EXPORT_FAILED", { message: `export failed: ${(err as Error).message}` });
  }
}

function loadRevisionProject(projectId: string, revisionId: string, name: string): Project {
  const doc = reconstructDocAtRevision(projectId, revisionId);
  if (!doc) throw new ApiError("REVISION_NOT_FOUND");
  return readProjectFromDoc(doc, projectId, name);
}

export function registerProjectImportExportRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/import", async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    const body = (req.body ?? {}) as { source?: string; dialect?: string };
    if (!body.source?.trim()) throw new ApiError("SOURCE_REQUIRED");

    const dialect = body.dialect ? requireSqlDialect(body.dialect) : null;
    const database = parseSource(body.source, dialect);
    const parsed = dialect
      ? toProject(database, project.name, body.source)
      : applyVisualMetadata(toProject(database, project.name, body.source), body.source);

    const room = getRoom(id);
    // Merge by table/field name rather than a blind overwrite, so reimporting
    // an updated schema keeps existing tables' positions/detail level instead
    // of resetting the whole layout every time.
    const merged = mergeProjectIntoExisting(readProjectFromDoc(room.doc, project.id, project.name), parsed);
    room.doc.transact(() => writeProjectToDoc(room.doc, merged), user.displayName);
    // An import can restructure an entire schema in one call, which is the
    // kind of change someone later asks "who did that, and when?" about.
    auditUser(user, "project.import", { type: "project", id }, `${merged.tables.length} table(s)`, req);
    return { imported: true, tables: merged.tables.length };
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
