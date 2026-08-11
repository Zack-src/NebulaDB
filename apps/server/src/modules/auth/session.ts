import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { db } from "../../infrastructure/db.js";

export interface SessionUser {
  id: string;
  email: string;
  isAdmin: boolean;
  displayName: string;
}

const SESSION_COOKIE = "athanordb_sid";

/**
 * Two session lengths, chosen at login ("stay signed in").
 *
 * The long one is the historical behaviour and stays the default, so nobody's
 * habits change. The short one exists for the case the long one is bad at: a
 * shared or borrowed machine, where a month-long rolling session is a month of
 * exposure for one afternoon of work. Both roll forward on use — the length is
 * an idle timeout, not a hard deadline.
 */
const LONG_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  email: string;
  is_admin: number;
  display_name: string | null;
  disabled_at: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  /** Null for rows created before this was stored — treated as the long default. */
  ttl_ms: number | null;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

/**
 * `maxAgeMs === null` writes a **session cookie** — no `Max-Age`, so the
 * browser drops it when it closes. That is the point of the short option:
 * on a shared machine, closing the browser should end the session without
 * relying on the user to remember to log out. The server-side expiry still
 * applies independently.
 */
function cookieOptions(maxAgeMs: number | null) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    // Self-hosted deployments may run plain HTTP — defaulting `secure` to
    // true would silently lock those out. Opt in via ATHANORDB_COOKIE_SECURE
    // once TLS is in front of the app (config.ts warns at boot if it's unset
    // in production).
    secure: config.cookieSecure,
    ...(maxAgeMs === null ? {} : { maxAge: Math.floor(maxAgeMs / 1000) }),
  };
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === 1,
    displayName: row.display_name?.trim() || row.email.split("@")[0],
  };
}

/**
 * Truncated hard: this is attacker-controlled input stored verbatim and shown
 * back in the user's own session list. 256 characters is longer than any real
 * user-agent string and short enough that a hostile one can't bloat the table.
 */
const MAX_USER_AGENT_LENGTH = 256;

export interface SessionOptions {
  /** `false` gives a 12-hour session cookie instead of the 30-day default. */
  remember?: boolean;
}

export function createSession(
  userId: string,
  reply: FastifyReply,
  req?: FastifyRequest,
  options: SessionOptions = {},
): void {
  const id = crypto.randomUUID();
  // Default `true`: the previous behaviour for every caller that doesn't ask.
  const remember = options.remember !== false;
  const ttlMs = remember ? LONG_SESSION_TTL_MS : SHORT_SESSION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  // Recorded so the user can recognise their own sessions in the revocation
  // list ("Firefox on the office machine") — without them, every row looks
  // identical and "log out everywhere" is the only usable action.
  const userAgent = req?.headers["user-agent"]?.slice(0, MAX_USER_AGENT_LENGTH) ?? null;
  const ip = req?.ip ?? null;
  // `ttl_ms` is stored per session, not derived from a constant at read time:
  // `resolveSession` rolls the expiry forward on every request, and without it
  // a short session would silently be promoted to a long one on its first use.
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, ttl_ms) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, userId, expiresAt, userAgent, ip, ttlMs);
  reply.setCookie(SESSION_COOKIE, id, cookieOptions(remember ? ttlMs : null));
}

/** The caller's own sessions, newest activity first, with the current one flagged. */
export function listSessions(userId: string, req: FastifyRequest): SessionSummary[] {
  const currentId = req.cookies?.[SESSION_COOKIE];
  const rows = db
    .prepare(
      `SELECT id, created_at, last_seen_at, expires_at, user_agent, ip
       FROM sessions WHERE user_id = ? AND expires_at > ?
       ORDER BY last_seen_at DESC`,
    )
    .all(userId, new Date().toISOString()) as {
    id: string;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
    user_agent: string | null;
    ip: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
    ip: row.ip,
    current: row.id === currentId,
  }));
}

/** Revokes one of the caller's own sessions. Scoped by `user_id` so an id guessed from elsewhere is useless. */
export function revokeSession(userId: string, sessionId: string): boolean {
  return db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(sessionId, userId).changes > 0;
}

/**
 * Revokes every session for a user except optionally one (the caller's own, so
 * "log out my other devices" doesn't log the caller out of the tab they're
 * clicking in). Also used with no exception when an account is disabled or
 * deleted.
 */
export function revokeAllSessions(userId: string, exceptSessionId?: string): number {
  if (exceptSessionId) {
    return db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, exceptSessionId).changes;
  }
  return db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
}

/** The session id the request is authenticated with, if any — needed to exclude it from a bulk revoke. */
export function currentSessionId(req: FastifyRequest): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

/** Drops the session cookie without touching the database — for when the row is already gone. */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply): void {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Resolves the session cookie into a verified user, rolling the session's
 * expiry forward on every hit (and re-setting the cookie to match). Never
 * rejects the request itself — this runs in a global `onRequest` hook so
 * public routes (login, invite accept, health) stay reachable; callers that
 * need a user call `requireUser`/`requireAdmin` against the resolved value.
 */
export function resolveSession(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) return null;

  const session = db.prepare("SELECT id, user_id, expires_at, ttl_ms FROM sessions WHERE id = ?").get(sessionId) as
    | SessionRow
    | undefined;
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;

  const user = db
    .prepare("SELECT id, email, is_admin, display_name, disabled_at FROM users WHERE id = ?")
    .get(session.user_id) as UserRow | undefined;
  if (!user) return null;
  // A disabled account is refused here rather than only at login: disabling
  // deletes the account's sessions, but this is the layer that has to hold if
  // one is ever recreated or missed (and it makes every route, WebSocket
  // included, reject the account without each one knowing about the flag).
  if (user.disabled_at) return null;

  // Roll forward by *this session's* own length. A session created before
  // `ttl_ms` existed has none stored, and gets the long default it was
  // originally created with.
  const ttlMs = session.ttl_ms ?? LONG_SESSION_TTL_MS;
  const newExpiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare("UPDATE sessions SET last_seen_at = datetime('now'), expires_at = ? WHERE id = ?").run(
    newExpiresAt,
    session.id,
  );
  reply.setCookie(SESSION_COOKIE, session.id, cookieOptions(ttlMs === SHORT_SESSION_TTL_MS ? null : ttlMs));

  return toSessionUser(user);
}

/**
 * Deletes rows whose expiry has passed. Sessions were previously only removed
 * on explicit logout or an admin password reset, so the table grew forever;
 * `resolveSession` already refuses to use an expired row, this just stops them
 * accumulating. Returns the number of rows removed.
 */
export function purgeExpiredSessions(): number {
  return db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString()).changes;
}
