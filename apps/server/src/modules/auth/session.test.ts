import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

// `db.ts` creates/opens its sqlite file at import time (see its module-level
// `new Database(DB_PATH)`), so the env var has to be set before anything
// that transitively imports it — a static `import` at the top of this file
// would already have run by then. A fresh temp path per test run also means
// this suite never touches the real dev/prod database.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";

const { db } = await import("../../infrastructure/db.js");
const {
  createSession,
  resolveSession,
  destroySession,
  purgeExpiredSessions,
  listSessions,
  revokeSession,
  revokeAllSessions,
} = await import("./session.js");
const { requireUser, requireAdmin } = await import("../../shared/guards.js");
const { ApiError } = await import("../../shared/errors.js");

function insertUser(overrides: { email?: string; isAdmin?: 0 | 1; displayName?: string | null } = {}): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)").run(
    id,
    overrides.email ?? `${id}@example.com`,
    "irrelevant-for-these-tests",
    overrides.isAdmin ?? 0,
    overrides.displayName ?? null,
  );
  return id;
}

/** Records what the route handler would have sent, instead of a real Fastify reply. */
function mockReply() {
  const cookiesSet: { name: string; value: string }[] = [];
  /** The options each `setCookie` was called with — `maxAge` distinguishes a persistent cookie from a session one. */
  const cookieOptionsUsed: { maxAge?: number }[] = [];
  const cookiesCleared: string[] = [];
  let statusCode: number | undefined;
  let body: unknown;
  const reply = {
    setCookie(name: string, value: string, options?: { maxAge?: number }) {
      cookiesSet.push({ name, value });
      cookieOptionsUsed.push(options ?? {});
      return reply;
    },
    clearCookie(name: string) {
      cookiesCleared.push(name);
      return reply;
    },
    code(c: number) {
      statusCode = c;
      return reply;
    },
    send(b: unknown) {
      body = b;
      return reply;
    },
  };
  return { reply, cookiesSet, cookieOptionsUsed, cookiesCleared, getStatus: () => statusCode, getBody: () => body };
}

function mockRequest(cookies: Record<string, string> = {}, user: unknown = undefined) {
  return { cookies, user } as unknown as FastifyRequest;
}

/** A request carrying the metadata `createSession` records so a user can recognise their own devices. */
function mockRequestWithMeta(userAgent: string, ip: string) {
  return { cookies: {}, headers: { "user-agent": userAgent }, ip } as unknown as FastifyRequest;
}

test("createSession -> resolveSession round-trips to the same user", () => {
  const userId = insertUser({ email: "alice@example.com", displayName: "Alice" });
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  assert.equal(cookiesSet.length, 1);

  const { name, value } = cookiesSet[0];
  const resolved = resolveSession(mockRequest({ [name]: value }), mockReply().reply as unknown as FastifyReply);
  assert.ok(resolved);
  assert.equal(resolved?.id, userId);
  assert.equal(resolved?.email, "alice@example.com");
  assert.equal(resolved?.displayName, "Alice");
  assert.equal(resolved?.isAdmin, false);
});

test("resolveSession falls back to the email's local part when display name is unset", () => {
  const userId = insertUser({ email: "bob@example.com", displayName: null });
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  const resolved = resolveSession(
    mockRequest({ [cookiesSet[0].name]: cookiesSet[0].value }),
    mockReply().reply as unknown as FastifyReply,
  );
  assert.equal(resolved?.displayName, "bob");
});

test("resolveSession returns null with no cookie, an unknown session id, or a garbage one", () => {
  assert.equal(resolveSession(mockRequest(), mockReply().reply as unknown as FastifyReply), null);
  assert.equal(
    resolveSession(mockRequest({ athanordb_sid: randomUUID() }), mockReply().reply as unknown as FastifyReply),
    null,
    "well-formed but never-issued session id",
  );
  assert.equal(
    resolveSession(mockRequest({ athanordb_sid: "not-a-uuid-at-all" }), mockReply().reply as unknown as FastifyReply),
    null,
  );
});

test("resolveSession rejects an expired session", () => {
  const userId = insertUser();
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  const { name, value } = cookiesSet[0];

  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), value);

  const resolved = resolveSession(mockRequest({ [name]: value }), mockReply().reply as unknown as FastifyReply);
  assert.equal(resolved, null);
});

test("resolveSession rolls the expiry forward and re-sets the cookie on every hit", () => {
  const userId = insertUser();
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  const { name, value } = cookiesSet[0];

  // Set it to something soon (but not expired) first — createSession's own
  // expiry is already ~30 days out, so comparing against that directly risks
  // both timestamps landing in the same millisecond in a fast test run.
  // Rolling forward from something obviously closer makes the "after" value
  // unambiguous regardless of clock resolution.
  const soon = new Date(Date.now() + 60_000).toISOString();
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(soon, value);

  const { reply: reply2, cookiesSet: cookiesSet2 } = mockReply();
  resolveSession(mockRequest({ [name]: value }), reply2 as unknown as FastifyReply);
  const after = (db.prepare("SELECT expires_at FROM sessions WHERE id = ?").get(value) as { expires_at: string })
    .expires_at;

  assert.ok(
    new Date(after).getTime() > new Date(soon).getTime(),
    "rolled forward from the ~1-minute mark to ~30 days out",
  );
  assert.equal(cookiesSet2.length, 1, "the session cookie is re-set on every resolve, not just on login");
  assert.equal(cookiesSet2[0].value, value, "same session id, just a later expiry");
});

test("destroySession deletes the row and clears the cookie — resolveSession then fails", () => {
  const userId = insertUser();
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  const { name, value } = cookiesSet[0];

  const { reply: destroyReply, cookiesCleared } = mockReply();
  destroySession(mockRequest({ [name]: value }), destroyReply as unknown as FastifyReply);
  assert.deepEqual(cookiesCleared, [name]);

  const resolved = resolveSession(mockRequest({ [name]: value }), mockReply().reply as unknown as FastifyReply);
  assert.equal(resolved, null);
});

test("destroySession with no cookie is a harmless no-op", () => {
  const { reply, cookiesCleared } = mockReply();
  destroySession(mockRequest(), reply as unknown as FastifyReply);
  assert.deepEqual(
    cookiesCleared,
    ["athanordb_sid"],
    "still clears the cookie client-side even if there was nothing to delete server-side",
  );
});

test("purgeExpiredSessions deletes only sessions whose expiry has passed", () => {
  // Earlier tests in this file deliberately leave their own expired rows
  // behind (that's the scenario they're testing) — this test shares the
  // same temp database, so it asserts relationally against its own two
  // sessions rather than an exact global `removed` count.
  const userId = insertUser();
  const { reply: r1, cookiesSet: s1 } = mockReply();
  createSession(userId, r1 as unknown as FastifyReply);
  const { reply: r2, cookiesSet: s2 } = mockReply();
  createSession(userId, r2 as unknown as FastifyReply);

  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
    new Date(Date.now() - 1000).toISOString(),
    s1[0].value,
  );

  const removed = purgeExpiredSessions();
  assert.ok(removed >= 1, "at least this test's own expired session was counted");
  assert.equal(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(s1[0].value), undefined, "expired row gone");
  assert.ok(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(s2[0].value), "live row untouched");

  const stillExpired = db
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ?")
    .get(new Date().toISOString()) as { n: number };
  assert.equal(stillExpired.n, 0, "nothing expired survives a purge, including rows other tests left behind");
});

test("requireUser passes through req.user, or throws AUTH_REQUIRED", () => {
  const user = { id: "u1", email: "a@b.com", isAdmin: false, displayName: "A" };
  assert.equal(requireUser(mockRequest({}, user)), user);

  assert.throws(
    () => requireUser(mockRequest({}, undefined)),
    (err: unknown) => err instanceof ApiError && err.code === "AUTH_REQUIRED" && err.status === 401,
  );
});

test("requireAdmin rejects a non-admin user and passes through an admin", () => {
  const admin = { id: "u1", email: "a@b.com", isAdmin: true, displayName: "A" };
  assert.equal(requireAdmin(mockRequest({}, admin)), admin);

  const nonAdmin = { id: "u2", email: "b@b.com", isAdmin: false, displayName: "B" };
  assert.throws(
    () => requireAdmin(mockRequest({}, nonAdmin)),
    (err: unknown) => err instanceof ApiError && err.code === "ADMIN_REQUIRED" && err.status === 403,
  );
});

test("a disabled account's existing session stops resolving", () => {
  // The offboarding path: disabling deletes the account's sessions, but this
  // is the layer that has to hold if one is ever recreated or missed.
  const userId = insertUser({ email: "leaver@example.com" });
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  const cookie = { [cookiesSet[0].name]: cookiesSet[0].value };

  assert.ok(resolveSession(mockRequest(cookie), mockReply().reply as unknown as FastifyReply), "valid before");
  db.prepare("UPDATE users SET disabled_at = datetime('now') WHERE id = ?").run(userId);
  assert.equal(
    resolveSession(mockRequest(cookie), mockReply().reply as unknown as FastifyReply),
    null,
    "refused once the account is disabled",
  );
});

test("listSessions returns a user's own sessions and flags the current one", () => {
  const userId = insertUser({ email: "multi@example.com" });
  const first = mockReply();
  createSession(userId, first.reply as unknown as FastifyReply, mockRequestWithMeta("Firefox/1.0", "10.0.0.1"));
  const second = mockReply();
  createSession(userId, second.reply as unknown as FastifyReply, mockRequestWithMeta("Chrome/2.0", "10.0.0.2"));

  const currentCookie = { [second.cookiesSet[0].name]: second.cookiesSet[0].value };
  const sessions = listSessions(userId, mockRequest(currentCookie));
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter((s) => s.current).length, 1, "exactly one is the caller's own");
  const current = sessions.find((s) => s.current)!;
  assert.equal(current.userAgent, "Chrome/2.0");
  assert.equal(current.ip, "10.0.0.2");
  assert.ok(
    sessions.some((s) => s.userAgent === "Firefox/1.0"),
    "the other device is listed too",
  );
});

test("listSessions never shows another user's sessions", () => {
  const mine = insertUser({ email: "mine@example.com" });
  const theirs = insertUser({ email: "theirs@example.com" });
  createSession(theirs, mockReply().reply as unknown as FastifyReply);
  assert.equal(listSessions(mine, mockRequest()).length, 0);
});

test("revokeSession only deletes a session the caller owns", () => {
  const owner = insertUser({ email: "owner@example.com" });
  const attacker = insertUser({ email: "attacker@example.com" });
  const { reply, cookiesSet } = mockReply();
  createSession(owner, reply as unknown as FastifyReply);
  const sessionId = cookiesSet[0].value;

  assert.equal(revokeSession(attacker, sessionId), false, "another user's id is not enough to revoke");
  assert.equal(listSessions(owner, mockRequest()).length, 1, "still there");
  assert.equal(revokeSession(owner, sessionId), true);
  assert.equal(listSessions(owner, mockRequest()).length, 0);
});

test("revokeAllSessions can keep the caller's own session", () => {
  const userId = insertUser({ email: "everywhere@example.com" });
  createSession(userId, mockReply().reply as unknown as FastifyReply);
  createSession(userId, mockReply().reply as unknown as FastifyReply);
  const keep = mockReply();
  createSession(userId, keep.reply as unknown as FastifyReply);
  const keptId = keep.cookiesSet[0].value;

  assert.equal(revokeAllSessions(userId, keptId), 2, "the other two are revoked");
  const left = listSessions(userId, mockRequest());
  assert.equal(left.length, 1);
  assert.equal(left[0].id, keptId, "the caller isn't logged out of the tab they clicked in");

  assert.equal(revokeAllSessions(userId), 1, "and with no exception, everything goes");
  assert.equal(listSessions(userId, mockRequest()).length, 0);
});

test("an unremembered session is short and rides in a browser-session cookie", () => {
  const userId = insertUser({ email: "shared-machine@example.com" });
  const { reply, cookiesSet, cookieOptionsUsed } = mockReply();
  createSession(userId, reply as unknown as FastifyReply, undefined, { remember: false });

  // No Max-Age: the browser drops it when it closes, which is the point on a
  // shared machine — the server-side expiry is the second layer, not the only.
  assert.equal(cookieOptionsUsed[0].maxAge, undefined);

  const row = db.prepare("SELECT ttl_ms, expires_at FROM sessions WHERE id = ?").get(cookiesSet[0].value) as {
    ttl_ms: number;
    expires_at: string;
  };
  assert.equal(row.ttl_ms, 12 * 60 * 60 * 1000);
  const hoursOut = (new Date(row.expires_at).getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursOut > 11 && hoursOut <= 12, `expires in ~12h, got ${hoursOut}`);
});

test("the default session stays the 30-day one", () => {
  const userId = insertUser({ email: "my-own-laptop@example.com" });
  const { reply, cookiesSet, cookieOptionsUsed } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  assert.equal(cookieOptionsUsed[0].maxAge, 30 * 24 * 60 * 60);
  const row = db.prepare("SELECT ttl_ms FROM sessions WHERE id = ?").get(cookiesSet[0].value) as { ttl_ms: number };
  assert.equal(row.ttl_ms, 30 * 24 * 60 * 60 * 1000);
});

test("using a short session rolls it forward by its own length, not the default", () => {
  // The bug this guards: `resolveSession` used to roll every session forward by
  // a single module constant, which would silently promote a 12-hour session to
  // a 30-day one on its first request.
  const userId = insertUser({ email: "rolling@example.com" });
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply, undefined, { remember: false });
  const sessionId = cookiesSet[0].value;

  resolveSession(mockRequest({ [cookiesSet[0].name]: sessionId }), mockReply().reply as unknown as FastifyReply);

  const row = db.prepare("SELECT expires_at FROM sessions WHERE id = ?").get(sessionId) as { expires_at: string };
  const hoursOut = (new Date(row.expires_at).getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursOut <= 12, `still a short session after use, got ${hoursOut}h`);
});

test("a session predating ttl_ms keeps the long default", () => {
  const userId = insertUser({ email: "legacy-session@example.com" });
  const { reply, cookiesSet } = mockReply();
  createSession(userId, reply as unknown as FastifyReply);
  const sessionId = cookiesSet[0].value;
  db.prepare("UPDATE sessions SET ttl_ms = NULL WHERE id = ?").run(sessionId);

  assert.ok(
    resolveSession(mockRequest({ [cookiesSet[0].name]: sessionId }), mockReply().reply as unknown as FastifyReply),
    "an existing session from before the column existed still resolves",
  );
  const row = db.prepare("SELECT expires_at FROM sessions WHERE id = ?").get(sessionId) as { expires_at: string };
  const daysOut = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
  assert.ok(daysOut > 29, `rolled forward by the long default, got ${daysOut} days`);
});
