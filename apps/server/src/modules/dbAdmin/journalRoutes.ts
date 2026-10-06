import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DbQueryStatSort } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { getConnectionById } from "../connections/repository.js";
import {
  getActivityWatch,
  listActivity,
  listTraffic,
  sampleActivity,
  setActivityWatch,
} from "../dbMonitor/activity.js";
import { buildHealthBoard } from "../dbMonitor/healthBoard.js";
import { listQueryStats } from "./queryStats.js";

const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
const SORTS: readonly DbQueryStatSort[] = ["frequency", "slowest", "total"];

/** Console routes whose use is written to the database's journal, and how. */
const OPENINGS: Record<string, { method: string; action: "dbconn.test" | "dbconn.open"; detail: string }> = {
  "/api/admin/connections/test": { method: "POST", action: "dbconn.test", detail: "test" },
  "/api/admin/connections/:id/health": { method: "POST", action: "dbconn.test", detail: "health check" },
  "/api/admin/connections/:id/overview": { method: "GET", action: "dbconn.open", detail: "console opened" },
  // The same console, reached by a member granted the database (or by an administrator from a project).
  "/api/connections/:id/overview": { method: "GET", action: "dbconn.open", detail: "console opened" },
};

function connectionOf(req: FastifyRequest): string | null {
  const params = req.params as { id?: string } | undefined;
  if (params?.id) return params.id;
  // The form's "Test" sends the connection's id when it is an existing one; a new one has no journal yet.
  const body = req.body as { id?: unknown } | null | undefined;
  return typeof body?.id === "string" ? body.id : null;
}

/**
 * A database's journal (Admin → Connexions → Ouvrir → Journal). Its entries
 * are the audit log's, filtered on the database by the existing activity
 * routes (`/api/admin/activity?connectionId=…`, export included); this file
 * adds what those lack: who appears in it, the statement figures of the SQL
 * console, and the journal entries for a connection tested or a console
 * opened — written here, around routes `dbAdmin/routes.ts` keeps unchanged.
 * Everything is for instance administrators.
 */
export function registerConnectionJournalRoutes(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    const opening = req.routeOptions.url ? OPENINGS[req.routeOptions.url] : undefined;
    if (!opening || req.method !== opening.method || !req.user) return payload;
    // A refusal to someone who may not use the console is not an opening of the database.
    if (!req.user.isAdmin && reply.statusCode >= 400) return payload;
    const connectionId = connectionOf(req);
    if (!connectionId || !getConnectionById(connectionId)) return payload;
    let detail = opening.detail;
    if (reply.statusCode >= 400) {
      detail += `: failed (${reply.statusCode})`;
    } else if (opening.action === "dbconn.test" && typeof payload === "string") {
      try {
        const body = JSON.parse(payload) as { ok?: boolean; error?: string };
        if (body.ok === false) detail += `: failed${body.error ? ` — ${body.error}` : ""}`;
        else if (body.ok === true) detail += ": ok";
      } catch {
        // Not JSON: the entry says the test ran, nothing more.
      }
    }
    auditUser(req.user, opening.action, { type: "connection", id: connectionId }, detail, req);
    return payload;
  });

  // The people who appear in a database's journal, for its "author" filter.
  app.get("/api/admin/connections/:id/journal/actors", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const actors = db
      .prepare(
        `SELECT a.actor_id AS id, COALESCE(u.display_name, MAX(a.actor_email)) AS name, MAX(a.actor_email) AS email
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.connection_id = ? AND a.actor_id IS NOT NULL
          GROUP BY a.actor_id ORDER BY name LIMIT 500`,
      )
      .all(id) as { id: string; name: string | null; email: string | null }[];
    return { actors };
  });

  // The "Santé" tab: a fresh probe, sizes, sessions, locks.
  app.get(
    "/api/admin/connections/:id/health-board",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      requireAdmin(req);
      const { id } = req.params as { id: string };
      const board = await buildHealthBoard(id);
      if (!board) throw new ApiError("CONNECTION_NOT_FOUND");
      return board;
    },
  );

  // What the database server itself shows: sessions and statements, whoever opened them.
  app.get("/api/admin/connections/:id/activity", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const connection = getConnectionById(id);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    const query = req.query as { days?: string; outside?: string };
    const days = query.days ? Number(query.days) : 1;
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ApiError("ACTIVITY_QUERY_INVALID");
    return {
      watch: getActivityWatch(id),
      entries: listActivity(connection, { sinceDays: days, outsideOnly: query.outside === "1" }),
    };
  });

  // The server's own counters, as differences between reads. `kind` says what "queries" counts.
  app.get("/api/admin/connections/:id/activity/traffic", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getConnectionById(id)) throw new ApiError("CONNECTION_NOT_FOUND");
    const days = Number((req.query as { days?: string }).days ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new ApiError("ACTIVITY_QUERY_INVALID");
    return listTraffic(id, days);
  });

  app.post("/api/admin/connections/:id/activity/sample", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const connection = getConnectionById(id);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    try {
      const sessions = await sampleActivity(connection);
      auditUser(user, "dbconn.activity.sample", { type: "connection", id }, `${sessions} session(s)`, req);
      return { sessions };
    } catch (err) {
      throw new ApiError("DB_ADMIN_QUERY_FAILED", { message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put("/api/admin/connections/:id/activity/watch", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getConnectionById(id)) throw new ApiError("CONNECTION_NOT_FOUND");
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled === true;
    setActivityWatch(id, enabled);
    auditUser(user, "dbconn.activity.watch", { type: "connection", id }, enabled ? "on" : "off", req);
    return getActivityWatch(id);
  });

  // Per statement shape: how often, how long — measured by Nebula, literals masked.
  app.get("/api/admin/connections/:id/query-stats", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getConnectionById(id)) throw new ApiError("CONNECTION_NOT_FOUND");
    const query = req.query as { days?: string; sort?: string; limit?: string };
    const days = query.days ? Number(query.days) : undefined;
    if (days !== undefined && (!Number.isInteger(days) || days < 0 || days > 3650)) {
      throw new ApiError("ACTIVITY_QUERY_INVALID");
    }
    if (query.sort !== undefined && !SORTS.includes(query.sort as DbQueryStatSort)) {
      throw new ApiError("ACTIVITY_QUERY_INVALID");
    }
    const limit = query.limit ? Number(query.limit) : undefined;
    if (limit !== undefined && !Number.isFinite(limit)) throw new ApiError("LIMIT_MUST_BE_NUMBER");
    return {
      stats: listQueryStats(id, { sinceDays: days || undefined, sort: query.sort as DbQueryStatSort, limit }),
    };
  });
}
