import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { db } from "../infrastructure/db.js";

/**
 * Append-only record of the actions nobody can afford to be unable to explain
 * later: who deleted a project, who changed who could see what, who reset
 * whose password, who took an account away.
 *
 * Deliberately narrow. This is not analytics and not a change feed — the Yjs
 * revision log already records every schema edit with its author, and
 * duplicating that here would bury the handful of events that matter under
 * thousands that don't. Only irreversible or permission-shaped actions are
 * recorded.
 *
 * Never modified or deleted by application code: there is no update path and
 * no delete route, so a compromised *application* account cannot rewrite the
 * trail. Someone with filesystem access to the SQLite file obviously can —
 * shipping tamper-evident logging (append-only external sink, hash chaining)
 * would be a different feature, and pretending otherwise would be worse than
 * saying so.
 */
export const AUDIT_ACTIONS = [
  "project.create",
  "project.delete",
  "project.archive",
  "project.restore",
  "project.import",
  "project.export",
  "project.revision.restore",
  "project.team.grant",
  "project.team.revoke",
  "team.create",
  "team.delete",
  "team.member.add",
  "team.member.remove",
  "user.password.reset",
  "user.password.reset_request",
  "user.password.reset_self",
  "user.disable",
  "user.enable",
  "user.delete",
  "user.sessions.revoke",
  "invitation.create",
  "invitation.revoke",
  "invitation.accept",
  "auth.login.locked",
  "auth.login.mfa_locked",
  "user.totp.enable",
  "user.totp.disable",
  "user.totp.backup_codes_regenerate",
  "connection.create",
  "connection.update",
  "connection.delete",
  "connection.pull",
  "connection.deploy",
  "connection.rollback",
  "connection.drift.dismiss",
  "dbconn.create",
  "dbconn.update",
  "dbconn.delete",
  "dbconn.link",
  "dbadmin.query",
  "dbadmin.drop",
  "dbuser.create",
  "dbuser.drop",
  "dbuser.alter",
  "dbuser.password",
  "dbuser.grant",
  "dbuser.revoke",
  "dbadmin.session.kill",
  "apikey.create",
  "apikey.revoke",
  "webhook.create",
  "webhook.update",
  "webhook.delete",
  "dbconn.policy",
  "instance.structure_policy",
  "dbadmin.structure.out_of_schema",
  "table.lock",
  "table.unlock",
  "environment.create",
  "environment.update",
  "environment.delete",
  "environment.reorder",
  "seed.set",
  "seed.remove",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * What an action is about, for the activity view's "type" filter. Derived
 * from the action, never stored: adding an action only needs a rule here.
 */
export type ActivityCategory =
  "structure" | "data" | "deployments" | "accounts" | "sessions" | "projects" | "configuration";

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "structure",
  "data",
  "deployments",
  "accounts",
  "sessions",
  "projects",
  "configuration",
];

/** First match wins. */
const CATEGORY_RULES: [RegExp, ActivityCategory][] = [
  [/^connection\.(deploy|rollback|pull|drift\.)/, "deployments"],
  [
    /^(table\.(lock|unlock)|dbadmin\.(drop|structure\.)|dbconn\.policy|instance\.structure_policy|project\.(import|revision\.restore))/,
    "structure",
  ],
  [/^(dbadmin\.query|seed\.|project\.export)/, "data"],
  [/^(auth\.|dbadmin\.session|user\.sessions|user\.totp)/, "sessions"],
  [/^(user\.|invitation\.|team\.|dbuser\.|project\.team\.|apikey\.)/, "accounts"],
  [/^project\./, "projects"],
];

export function activityCategory(action: string): ActivityCategory {
  return CATEGORY_RULES.find(([pattern]) => pattern.test(action))?.[1] ?? "configuration";
}

/** Links an entry to what it concerns, beyond its target: the project and the database it touched. */
export interface AuditContext {
  projectId?: string | null;
  connectionId?: string | null;
}

export interface AuditActor {
  id: string | null;
  email: string | null;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  ip: string | null;
}

interface AuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
}

/** Bounds a single row: `detail` is assembled from names/emails that are themselves capped, but never trust that twice. */
const MAX_DETAIL_LENGTH = 500;

/**
 * Writes one audit row. Never throws: a failed audit write must not turn a
 * successful action into a 500, and must not roll back the action it describes
 * (these calls sit alongside route logic, not inside its transaction). A
 * failure is logged loudly instead — losing an audit row is bad, losing the
 * user's actual operation because of one is worse.
 */
export function audit(
  actor: AuditActor,
  action: AuditAction,
  target: { type: string; id: string } | null,
  detail?: string,
  req?: FastifyRequest,
  context: AuditContext = {},
): void {
  try {
    // The project and connection default to the target when it is one.
    const projectId = context.projectId ?? (target?.type === "project" ? target.id : null);
    const connectionId = context.connectionId ?? (target?.type === "connection" ? target.id : null);
    db.prepare(
      `INSERT INTO audit_log (id, actor_id, actor_email, action, target_type, target_id, detail, ip, project_id, connection_id, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      actor.id,
      actor.email,
      action,
      target?.type ?? null,
      target?.id ?? null,
      detail?.slice(0, MAX_DETAIL_LENGTH) ?? null,
      req?.ip ?? null,
      projectId,
      connectionId,
      // Fastify's request id: every entry one request produced shares it.
      req?.id ? String(req.id) : null,
    );
  } catch (err) {
    console.error(`[audit] failed to record ${action}:`, err);
  }
}

/** Convenience wrapper for the common case where the actor is the authenticated user. */
export function auditUser(
  user: { id: string; email: string } | null,
  action: AuditAction,
  target: { type: string; id: string } | null,
  detail?: string,
  req?: FastifyRequest,
  context?: AuditContext,
): void {
  audit({ id: user?.id ?? null, email: user?.email ?? null }, action, target, detail, req, context);
}

/**
 * Deletes entries older than `retentionDays`. `0` keeps everything — an
 * operator whose own rules require an indefinite trail should not have one
 * silently trimmed under them.
 *
 * Uses SQLite's own clock for the cutoff rather than a JS timestamp:
 * `created_at` is written by `datetime('now')` (`YYYY-MM-DD HH:MM:SS`), which
 * does not sort correctly against a `toISOString()` value on the same date.
 */
export function purgeOldAuditEntries(retentionDays: number): number {
  if (retentionDays <= 0) return 0;
  return db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', ?)`).run(`-${retentionDays} days`)
    .changes;
}

export interface AuditQuery {
  limit?: number;
  before?: string;
  action?: string;
  targetId?: string;
}

/** Newest first. Read-only, admin-only at the route layer. */
export function listAuditLog(query: AuditQuery = {}): AuditEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.before) {
    conditions.push("created_at < ?");
    params.push(query.before);
  }
  if (query.action) {
    conditions.push("action = ?");
    params.push(query.action);
  }
  if (query.targetId) {
    conditions.push("target_id = ?");
    params.push(query.targetId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, created_at, actor_id, actor_email, action, target_type, target_id, detail, ip
       FROM audit_log ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(...params, limit) as AuditRow[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail,
    ip: row.ip,
  }));
}

export interface ActivityQuery {
  /** `YYYY-MM-DD HH:MM:SS` UTC bounds, inclusive. */
  from?: string;
  to?: string;
  category?: ActivityCategory;
  actorId?: string;
  projectId?: string;
  connectionId?: string;
  /** Free text, matched in the action, the detail and the actor's e-mail. */
  search?: string;
  /** The `cursor` of the previous page. */
  cursor?: number;
  limit?: number;
}

export interface ActivityEntry extends AuditEntry {
  category: ActivityCategory;
  projectId: string | null;
  projectName: string | null;
  connectionId: string | null;
  connectionName: string | null;
  correlationId: string | null;
  actorName: string | null;
}

interface ActivityRow extends AuditRow {
  seq: number;
  project_id: string | null;
  project_name: string | null;
  connection_id: string | null;
  connection_name: string | null;
  correlation_id: string | null;
  actor_name: string | null;
}

export const ACTIVITY_PAGE_MAX = 200;
export const ACTIVITY_EXPORT_MAX = 10_000;

/**
 * The activity view: the audit trail, newest first, filtered, a page at a
 * time. The cursor is the row's insertion order (`rowid`), so pages neither
 * skip nor repeat entries written while someone is reading. Names of the
 * project, connection and actor are joined live — an entry about a deleted
 * project still shows, without a name.
 */
export function listActivity(
  query: ActivityQuery = {},
  max = ACTIVITY_PAGE_MAX,
): {
  entries: ActivityEntry[];
  nextCursor: number | null;
} {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), max);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.cursor !== undefined) {
    conditions.push("a.rowid < ?");
    params.push(query.cursor);
  }
  if (query.from) {
    conditions.push("a.created_at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    conditions.push("a.created_at <= ?");
    params.push(query.to);
  }
  if (query.category) {
    const actions = AUDIT_ACTIONS.filter((action) => activityCategory(action) === query.category);
    conditions.push(`a.action IN (${actions.map(() => "?").join(", ") || "NULL"})`);
    params.push(...actions);
  }
  if (query.actorId) {
    conditions.push("a.actor_id = ?");
    params.push(query.actorId);
  }
  if (query.projectId) {
    conditions.push("a.project_id = ?");
    params.push(query.projectId);
  }
  if (query.connectionId) {
    conditions.push("a.connection_id = ?");
    params.push(query.connectionId);
  }
  if (query.search) {
    const like = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push("(a.action LIKE ? ESCAPE '\\' OR a.detail LIKE ? ESCAPE '\\' OR a.actor_email LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT a.rowid AS seq, a.id, a.created_at, a.actor_id, a.actor_email, a.action, a.target_type, a.target_id,
              a.detail, a.ip, a.project_id, a.connection_id, a.correlation_id,
              p.name AS project_name, c.name AS connection_name, u.display_name AS actor_name
         FROM audit_log a
         LEFT JOIN projects p ON p.id = a.project_id
         LEFT JOIN db_connections c ON c.id = a.connection_id
         LEFT JOIN users u ON u.id = a.actor_id
         ${where}
        ORDER BY a.rowid DESC LIMIT ?`,
    )
    .all(...params, limit + 1) as ActivityRow[];
  const page = rows.slice(0, limit);
  return {
    entries: page.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      action: row.action,
      category: activityCategory(row.action),
      targetType: row.target_type,
      targetId: row.target_id,
      detail: row.detail,
      ip: row.ip,
      projectId: row.project_id,
      projectName: row.project_name,
      connectionId: row.connection_id,
      connectionName: row.connection_name,
      correlationId: row.correlation_id,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].seq : null,
  };
}
