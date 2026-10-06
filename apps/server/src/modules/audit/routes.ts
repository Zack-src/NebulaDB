import type { FastifyInstance } from "fastify";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_EXPORT_MAX,
  listActivity,
  listAuditLog,
  type ActivityCategory,
  type ActivityEntry,
  type ActivityQuery,
} from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";

/**
 * Read-only view of the audit trail, admin-only.
 *
 * There is deliberately no write route and no delete route: entries are
 * produced by the actions themselves (see `audit.ts`), and an API that let an
 * administrator edit the record of what administrators did would defeat the
 * point of keeping one.
 */
export function registerAuditRoutes(app: FastifyInstance): void {
  app.get("/api/audit", async (req) => {
    requireAdmin(req);
    const { limit, before, action, targetId } = req.query as {
      limit?: string;
      before?: string;
      action?: string;
      targetId?: string;
    };
    const parsedLimit = limit ? Number(limit) : undefined;
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) throw new ApiError("LIMIT_MUST_BE_NUMBER");
    return listAuditLog({ limit: parsedLimit, before, action, targetId });
  });

  // The activity view (Admin → Activité): the same trail, filtered and paged.
  app.get("/api/admin/activity", async (req) => {
    requireAdmin(req);
    return listActivity(parseActivityQuery(req.query));
  });

  // Everything the filters match (up to ACTIVITY_EXPORT_MAX rows), as CSV or JSON.
  app.get("/api/admin/activity/export", async (req, reply) => {
    requireAdmin(req);
    const { format } = req.query as { format?: string };
    const { entries } = listActivity(
      { ...parseActivityQuery(req.query), limit: ACTIVITY_EXPORT_MAX },
      ACTIVITY_EXPORT_MAX,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      reply.header("content-disposition", `attachment; filename="nebuladb-activity-${stamp}.json"`);
      return entries;
    }
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="nebuladb-activity-${stamp}.csv"`);
    return activityCsv(entries);
  });
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

/** Query-string filters of the activity routes; anything malformed is refused rather than ignored. */
function parseActivityQuery(raw: unknown): ActivityQuery {
  const q = (raw ?? {}) as Record<string, string | undefined>;
  const query: ActivityQuery = {};
  for (const key of ["from", "to"] as const) {
    const value = q[key];
    if (value === undefined || value === "") continue;
    if (!TIMESTAMP.test(value)) throw new ApiError("ACTIVITY_QUERY_INVALID");
    query[key] = value;
  }
  if (q.category) {
    if (!ACTIVITY_CATEGORIES.includes(q.category as ActivityCategory)) throw new ApiError("ACTIVITY_QUERY_INVALID");
    query.category = q.category as ActivityCategory;
  }
  for (const key of ["actorId", "projectId", "connectionId"] as const) {
    if (q[key]) query[key] = q[key]!.slice(0, 200);
  }
  if (q.search) query.search = q.search.slice(0, 200);
  if (q.cursor) {
    const cursor = Number(q.cursor);
    if (!Number.isInteger(cursor) || cursor < 0) throw new ApiError("ACTIVITY_QUERY_INVALID");
    query.cursor = cursor;
  }
  if (q.limit) {
    const limit = Number(q.limit);
    if (!Number.isFinite(limit)) throw new ApiError("LIMIT_MUST_BE_NUMBER");
    query.limit = limit;
  }
  return query;
}

/** RFC 4180; a cell a spreadsheet would run as a formula is prefixed with a quote. */
function activityCsv(entries: ActivityEntry[]): string {
  const cell = (value: string | null) => {
    if (value === null) return "";
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = [
    "date_utc",
    "category",
    "action",
    "actor",
    "actor_email",
    "project",
    "connection",
    "target",
    "detail",
    "ip",
    "correlation_id",
  ];
  const lines = entries.map((e) =>
    [
      e.createdAt,
      e.category,
      e.action,
      e.actorName,
      e.actorEmail,
      e.projectName ?? e.projectId,
      e.connectionName ?? e.connectionId,
      e.targetType ? `${e.targetType}/${e.targetId ?? ""}` : null,
      e.detail,
      e.ip,
      e.correlationId,
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}
