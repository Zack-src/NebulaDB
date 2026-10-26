import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { Project } from "@nebuladb/shared";
import { projectToSql, type SqlDialect } from "@nebuladb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import { isSqlDialect, SQL_DIALECTS } from "../../shared/sqlDialect.js";
import { parsePool } from "./parsePool.js";
import type { ParseResult, ParseTask } from "./parseTask.js";

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
 * Recently parsed sources, keyed by a hash of (dialect, project name, text).
 * The DBML panel posts `{ source, baseline }` on every typing pause, and each
 * sync's `baseline` is the previous sync's `source` — so without this every
 * pause parsed the same unchanged text a second time. Holding the promise
 * rather than the result also folds concurrent parses of one text into one.
 *
 * Only successes are kept (a failure is cheap to redo, and a timeout isn't a
 * property of the text). Entries are frozen: they're handed to several imports
 * in turn, and the merge helpers only ever read them — a stray mutation would
 * otherwise corrupt the next request's baseline silently instead of throwing.
 * Small LRU: a 500-table project is a few MB of objects.
 */
const PARSE_CACHE_MAX = 16;
const parseCache = new Map<string, Promise<ParseResult>>();

function parseCacheKey(task: ParseTask): string {
  return createHash("sha256")
    .update(`${task.dialect ?? "dbml"}\0${task.projectName}\0`)
    .update(task.source)
    .digest("base64");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function parseCached(task: ParseTask): Promise<ParseResult> {
  const key = parseCacheKey(task);
  const hit = parseCache.get(key);
  if (hit) {
    // Re-insert to mark it most recently used.
    parseCache.delete(key);
    parseCache.set(key, hit);
    return hit;
  }
  const pending = parsePool()
    .run(task)
    .then((result) => {
      if (result.ok) deepFreeze(result.project);
      else if (parseCache.get(key) === pending) parseCache.delete(key);
      return result;
    });
  parseCache.set(key, pending);
  while (parseCache.size > PARSE_CACHE_MAX) parseCache.delete(parseCache.keys().next().value!);
  return pending;
}

/** Test hook: forget every cached parse. */
export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * Parses submitted source into a `Project` — off the event loop, see
 * `parsePool.ts` — translating the engine's own diagnostic into a 400 that
 * keeps its line/column so the editor can place a marker on the offending
 * line. DBML gets its visual-metadata sidecar applied; SQL has none.
 *
 * The result may be shared with other imports through the cache: treat it as
 * read-only (it is frozen).
 */
export async function parseSourceProject(
  source: string,
  dialect: SqlDialect | null,
  projectName: string,
): Promise<Project> {
  const result = await parseCached({ source, dialect, projectName });
  if (result.ok) return result.project;
  if (result.kind === "internal") throw new Error(result.message);
  throw new ApiError(dialect ? "SQL_PARSE_FAILED" : "DBML_PARSE_FAILED", {
    message: `${dialect ? "SQL" : "DBML"} parse error: ${result.error.message}`,
    details: result.error as unknown as Record<string, unknown>,
  });
}

/**
 * Parses the baseline the client says its buffer came from. A baseline that
 * no longer parses (hand-edited, or from a version that wrote something this
 * parser rejects) is treated as "no baseline": the import still applies, it
 * just loses the concurrent-edit protection rather than failing outright.
 * Usually a cache hit: it's the text the previous sync sent as its `source`.
 */
export async function parseBaselineProject(baseline: string, projectName: string): Promise<Project> {
  const result = await parseCached({ source: baseline, dialect: null, projectName });
  if (result.ok) return result.project;
  return { id: "", name: projectName, tables: [], refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

export function sendSql(reply: FastifyReply, project: Project, dialect: SqlDialect) {
  try {
    return reply.type("text/plain").send(projectToSql(project, dialect));
  } catch (err) {
    throw new ApiError("EXPORT_FAILED", { message: `export failed: ${(err as Error).message}` });
  }
}
