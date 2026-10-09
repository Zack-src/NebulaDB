import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { CONSOLE_ROUTES, MAX_SQL_LENGTH, READ_LIMIT, WRITE_LIMIT } from "./routeKit.js";
import {
  MAX_SAVED_DESCRIPTION_LENGTH,
  MAX_SAVED_NAME_LENGTH,
  MAX_SAVED_QUERIES,
  countSavedQueries,
  deleteSavedQuery,
  findOwnSavedQueryByName,
  getSavedQuery,
  getSavedQueryRecord,
  insertSavedQuery,
  listSavedQueries,
  updateSavedQuery,
  type SavedQueryChanges,
} from "./savedQueries.js";

function invalid(): ApiError {
  return new ApiError("SAVED_QUERY_INVALID");
}

function parseName(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) throw invalid();
  const name = value.trim();
  if (!name || name.length > MAX_SAVED_NAME_LENGTH) throw invalid();
  return name;
}

function parseSql(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_SQL_LENGTH) throw invalid();
  return value;
}

function parseDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_SAVED_DESCRIPTION_LENGTH) throw invalid();
  return value.trim() || null;
}

/**
 * Saved queries, on both route families and under the same rule as the SQL
 * console itself (`CONSOLE_ROUTES`): whoever cannot use the console of a
 * connection is told it does not exist. A saved query is text and gives no
 * right — running it goes through the query route, with the caller's own access.
 */
export function registerSavedQueryRoutes(app: FastifyInstance): void {
  for (const [prefix, guard] of CONSOLE_ROUTES) {
    app.get(`${prefix}/:id/saved-queries`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { user } = guard(req, id);
      return { queries: listSavedQueries(id, user.id) };
    });

    app.post(`${prefix}/:id/saved-queries`, WRITE_LIMIT, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { user } = guard(req, id);
      const body = (req.body ?? {}) as { name?: unknown; sql?: unknown; description?: unknown; overwrite?: unknown };
      const name = parseName(body.name);
      const sql = parseSql(body.sql);
      const description = parseDescription(body.description);
      const existing = findOwnSavedQueryByName(id, user.id, name);
      if (existing) {
        // Replacing one's own query is asked for explicitly, never a side effect of saving.
        if (body.overwrite !== true) throw new ApiError("SAVED_QUERY_NAME_TAKEN");
        updateSavedQuery(existing, { sql, description });
        auditUser(user, "savedquery.update", { type: "connection", id }, `overwrite "${name}"`, req);
        return { query: getSavedQuery(id, existing, user.id) };
      }
      if (countSavedQueries(id, user.id) >= MAX_SAVED_QUERIES) throw new ApiError("SAVED_QUERY_LIMIT");
      const queryId = insertSavedQuery({ connectionId: id, userId: user.id, name, sql, description });
      auditUser(user, "savedquery.create", { type: "connection", id }, `"${name}"`, req);
      reply.code(201);
      return { query: getSavedQuery(id, queryId, user.id) };
    });

    app.patch(`${prefix}/:id/saved-queries/:queryId`, WRITE_LIMIT, async (req) => {
      const { id, queryId } = req.params as { id: string; queryId: string };
      const { user } = guard(req, id);
      const record = getSavedQueryRecord(id, queryId);
      // Someone else's private query does not exist for the caller.
      if (!record || (record.userId !== user.id && !record.shared)) throw new ApiError("SAVED_QUERY_NOT_FOUND");
      if (record.userId !== user.id) throw new ApiError("SAVED_QUERY_NOT_OWNER");
      const body = (req.body ?? {}) as { name?: unknown; sql?: unknown; description?: unknown; shared?: unknown };
      const changes: SavedQueryChanges = {};
      if (body.name !== undefined) changes.name = parseName(body.name);
      if (body.sql !== undefined) changes.sql = parseSql(body.sql);
      if (body.description !== undefined) changes.description = parseDescription(body.description);
      if (body.shared !== undefined) {
        if (typeof body.shared !== "boolean") throw invalid();
        changes.shared = body.shared;
      }
      if (Object.keys(changes).length === 0) throw invalid();
      if (changes.name !== undefined && changes.name !== record.name) {
        const taken = findOwnSavedQueryByName(id, user.id, changes.name);
        if (taken && taken !== record.id) throw new ApiError("SAVED_QUERY_NAME_TAKEN");
      }
      updateSavedQuery(record.id, changes);
      const edited = changes.name !== undefined || changes.sql !== undefined || changes.description !== undefined;
      const name = changes.name ?? record.name;
      if (edited) auditUser(user, "savedquery.update", { type: "connection", id }, `"${name}"`, req);
      if (changes.shared !== undefined && changes.shared !== record.shared) {
        auditUser(
          user,
          changes.shared ? "savedquery.share" : "savedquery.unshare",
          { type: "connection", id },
          `"${name}"`,
          req,
        );
      }
      return { query: getSavedQuery(id, record.id, user.id) };
    });

    app.delete(`${prefix}/:id/saved-queries/:queryId`, WRITE_LIMIT, async (req) => {
      const { id, queryId } = req.params as { id: string; queryId: string };
      const { user, access } = guard(req, id);
      const record = getSavedQueryRecord(id, queryId);
      // An instance administrator removes any; the author removes their own.
      const allowed = record && (record.userId === user.id || access === "admin");
      if (!record || (!allowed && !record.shared)) throw new ApiError("SAVED_QUERY_NOT_FOUND");
      if (!allowed) throw new ApiError("SAVED_QUERY_NOT_OWNER");
      deleteSavedQuery(record.id);
      auditUser(
        user,
        "savedquery.delete",
        { type: "connection", id },
        `"${record.name}"${record.userId === user.id ? "" : ` of ${record.userId}`}`,
        req,
      );
      return { deleted: true };
    });
  }
}
