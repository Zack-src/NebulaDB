import type { FastifyInstance } from "fastify";
import { auditUser } from "../audit.js";
import { db } from "../db.js";
import { normalizeEmail } from "../auth/email.js";
import { checkLock, clearFailures, recordFailure } from "../auth/lockout.js";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "../auth/password.js";
import {
  clearSessionCookie,
  createSession,
  currentSessionId,
  destroySession,
  listSessions,
  requireUser,
  revokeAllSessions,
  revokeSession,
} from "../auth/session.js";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  is_admin: number;
  display_name: string | null;
  disabled_at: string | null;
}

/**
 * Login is the one unauthenticated route that does expensive work (scrypt) and
 * guards every account, so it gets a per-IP limit: 10 attempts a minute is
 * far beyond human typing and far below anything useful for guessing.
 */
const LOGIN_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/api/auth/login", LOGIN_RATE_LIMIT, async (req, reply) => {
    const { email, password, remember } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      remember?: boolean;
    };
    const normalized = normalizeEmail(email);
    if (!normalized || !password) {
      reply.code(400);
      return { error: "email and password are required" };
    }
    // Bail before hashing: an arbitrarily long password would otherwise make
    // every failed attempt disproportionately expensive to serve.
    if (password.length > MAX_PASSWORD_LENGTH) {
      reply.code(401);
      return { error: "invalid email or password" };
    }

    // Checked before the scrypt verification below: a locked account should
    // not keep paying ~100ms of hashing per attempt, which is exactly the
    // amplification the lock exists to stop.
    const lock = checkLock(normalized);
    if (lock.locked) {
      auditUser(null, "auth.login.locked", { type: "user", id: normalized }, "attempt while locked", req);
      reply.code(429);
      return { error: "too many failed attempts — this account is temporarily locked", retryAfter: lock.until };
    }

    const row = db
      .prepare("SELECT id, email, password_hash, is_admin, display_name, disabled_at FROM users WHERE email = ?")
      .get(normalized) as UserRow | undefined;
    // Generic error either way — doesn't reveal whether the email is registered.
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      // Only counted for accounts that exist: an attacker inventing addresses
      // would otherwise grow this table without bound, and there is nothing to
      // protect for an account that isn't there.
      const state = row ? recordFailure(normalized) : { locked: false };
      if (state.locked) {
        reply.code(429);
        return { error: "too many failed attempts — this account is temporarily locked", retryAfter: state.until };
      }
      reply.code(401);
      return { error: "invalid email or password" };
    }

    // Deliberately after password verification: someone who can't produce the
    // password learns nothing about whether the account exists or is disabled.
    if (row.disabled_at) {
      reply.code(403);
      return { error: "this account has been disabled" };
    }

    clearFailures(normalized);
    // Absent means "yes" — the historical 30-day behaviour, so an older client
    // (or a script) that doesn't send the field is unaffected.
    createSession(row.id, reply, req, { remember: remember !== false });
    return {
      id: row.id,
      email: row.email,
      isAdmin: row.is_admin === 1,
      displayName: row.display_name?.trim() || row.email.split("@")[0],
    };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    destroySession(req, reply);
    return { loggedOut: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return user;
  });

  /**
   * A user's own active sessions. Before this there was no way to see where an
   * account was logged in, and no way to end a session other than waiting out
   * its 30-day expiry — a stolen laptop or a session left open on a shared
   * machine could only be handled by an admin resetting the password.
   */
  app.get("/api/auth/sessions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return listSessions(user.id, req);
  });

  app.delete("/api/auth/sessions/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!revokeSession(user.id, id)) {
      reply.code(404);
      return { error: "not found" };
    }
    // Revoking the session the request itself is authenticated with is a
    // logout — clear the cookie too, or the browser keeps sending a dead id.
    if (id === currentSessionId(req)) clearSessionCookie(reply);
    auditUser(user, "user.sessions.revoke", { type: "user", id: user.id }, "single session", req);
    return { revoked: true };
  });

  /** "Log out everywhere else" — keeps the caller's own session so they aren't kicked out of the tab they clicked in. */
  app.post("/api/auth/sessions/revoke-others", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const revoked = revokeAllSessions(user.id, currentSessionId(req));
    auditUser(user, "user.sessions.revoke", { type: "user", id: user.id }, `${revoked} other session(s)`, req);
    return { revoked };
  });
}
