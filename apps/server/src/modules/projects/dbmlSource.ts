import type { FastifyReply } from "fastify";
import type { Project } from "@athanordb/shared";
import {
  applyVisualMetadata,
  describeDbmlParseError,
  parseDbml,
  parseSql,
  projectToSql,
  toProject,
  type SqlDialect,
} from "@athanordb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import { isSqlDialect, SQL_DIALECTS } from "../../shared/sqlDialect.js";

/**
 * Shared by every route that accepts or emits DBML/SQL source text — the
 * session-only `/api/projects/:id/import|export` routes
 * (`routes/importExport.ts`) and the key-authable `/api/v1` equivalents
 * (`modules/publicApi/index.ts`). Split out here rather than left inline in
 * `importExport.ts` once a second caller needed the exact same parse/export
 * logic — a second copy would drift the moment one of the two got a bugfix
 * the other didn't.
 */

export function requireSqlDialect(value: unknown): SqlDialect {
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
export function parseSource(source: string, dialect: SqlDialect | null) {
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

/**
 * Parses the baseline the client says its buffer came from. A baseline that
 * no longer parses (hand-edited, or from a version that wrote something this
 * parser rejects) is treated as "no baseline": the import still applies, it
 * just loses the concurrent-edit protection rather than failing outright.
 */
export function parseBaselineProject(baseline: string, projectName: string): Project {
  try {
    return applyVisualMetadata(toProject(parseDbml(baseline), projectName, baseline), baseline);
  } catch {
    return { id: "", name: projectName, tables: [], refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] };
  }
}

export function sendSql(reply: FastifyReply, project: Project, dialect: SqlDialect) {
  try {
    return reply.type("text/plain").send(projectToSql(project, dialect));
  } catch (err) {
    throw new ApiError("EXPORT_FAILED", { message: `export failed: ${(err as Error).message}` });
  }
}
