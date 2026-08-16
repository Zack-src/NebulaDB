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
export type AuditAction =
  | "project.create"
  | "project.delete"
  | "project.archive"
  | "project.restore"
  | "project.import"
  | "project.export"
  | "project.revision.restore"
  | "project.team.grant"
  | "project.team.revoke"
  | "team.create"
  | "team.delete"
  | "team.member.add"
  | "team.member.remove"
  | "user.password.reset"
  | "user.disable"
  | "user.enable"
  | "user.delete"
  | "user.sessions.revoke"
  | "invitation.create"
  | "invitation.revoke"
  | "invitation.accept"
  | "auth.login.locked"
  | "auth.login.mfa_locked"
  | "user.totp.enable"
  | "user.totp.disable"
  | "user.totp.backup_codes_regenerate"
  | "connection.create"
  | "connection.update"
  | "connection.delete"
  | "connection.pull"
  | "connection.deploy"
  | "connection.rollback";

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
): void {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, actor_id, actor_email, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      actor.id,
      actor.email,
      action,
      target?.type ?? null,
      target?.id ?? null,
      detail?.slice(0, MAX_DETAIL_LENGTH) ?? null,
      req?.ip ?? null,
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
): void {
  audit({ id: user?.id ?? null, email: user?.email ?? null }, action, target, detail, req);
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
