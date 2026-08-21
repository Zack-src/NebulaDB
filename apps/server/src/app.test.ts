import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `db.ts` opens its sqlite file at import time (see its module-level `new
// Database(DB_PATH)`), so the env var has to be set before anything that
// transitively imports it — a static `import` at the top of this file would
// already have run by then. A fresh temp path per test run also means this
// suite never touches the real dev/prod database, and `ATHANORDB_SECRET` is
// set once here so any test that happens to exercise the connections module
// doesn't have to know that's a prerequisite. See `session.test.ts` for the
// same pattern.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-app-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
// Otherwise every request this suite makes (dozens, across 8 tests) logs a
// full request/response line to stdout — real signal for a running server,
// pure noise in a test run.
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("./app.js");
const { db } = await import("./infrastructure/db.js");
const { hashPassword } = await import("./modules/auth/password.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

/**
 * Every REST route this suite hits requires this pair on a state-changing
 * request (see `app.ts`'s CSRF hook) — same-origin `Origin`, and the `Host`
 * `light-my-request` otherwise defaults away from. Centralised here so a
 * missing header on one call isn't a silent 403 mistaken for the thing the
 * test meant to check.
 */
function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

function insertUser(overrides: { email?: string; isAdmin?: 0 | 1; passwordHash: string; displayName?: string }) {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)").run(
    id,
    overrides.email ?? `${id}@example.com`,
    overrides.passwordHash,
    overrides.isAdmin ?? 0,
    overrides.displayName ?? null,
  );
  return id;
}

async function makeUser(opts: { isAdmin?: 0 | 1; password?: string } = {}) {
  const password = opts.password ?? "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = insertUser({ email, isAdmin: opts.isAdmin, passwordHash: await hashPassword(password) });
  return { id, email, password };
}

/** Logs in and returns the `cookie` header value for authenticated requests, plus the parsed session response body. */
async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sessionCookie = res.cookies.find((c) => c.name === "athanordb_sid");
  return { res, cookie: sessionCookie ? `athanordb_sid=${sessionCookie.value}` : undefined, body: res.json() };
}

test("GET /api/health reports ok with a working database", async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, "ok");
    assert.equal(typeof body.projects, "number");
  } finally {
    await app.close();
  }
});

test("CSRF hook: cross-origin state-changing request is rejected, same-origin and no-origin pass", async () => {
  const app = await buildApp();
  try {
    const crossOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { host: HOST, origin: "http://evil.example.com" },
    });
    assert.equal(crossOrigin.statusCode, 403);
    assert.equal(crossOrigin.json().code, "ORIGIN_MISMATCH");

    const sameOrigin = await app.inject({ method: "POST", url: "/api/auth/logout", headers: headers() });
    assert.equal(sameOrigin.statusCode, 200);

    // No Origin header at all (curl, scripts, backup tooling) must still work.
    const noOrigin = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { host: HOST } });
    assert.equal(noOrigin.statusCode, 200);

    // GET is a safe method — never subject to the check, even cross-origin.
    const safeGet = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: HOST, origin: "http://evil.example.com" },
    });
    assert.equal(safeGet.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("login: wrong password, disabled account, and a successful login round-trip", async () => {
  const app = await buildApp();
  try {
    const { email, password, id } = await makeUser();

    const wrongPassword = await login(app, email, "not the right password");
    assert.equal(wrongPassword.res.statusCode, 401);
    assert.equal(wrongPassword.body.code, "INVALID_CREDENTIALS");

    const ok = await login(app, email, password);
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.body.email, email);
    assert.ok(ok.cookie, "login did not set a session cookie");

    // The cookie actually authenticates a follow-up request.
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: headers({ cookie: ok.cookie! }) });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().id, id);

    // Disabled after the fact — login must refuse even the right password.
    db.prepare("UPDATE users SET disabled_at = datetime('now') WHERE id = ?").run(id);
    const disabled = await login(app, email, password);
    assert.equal(disabled.res.statusCode, 403);
    assert.equal(disabled.body.code, "ACCOUNT_DISABLED");
  } finally {
    await app.close();
  }
});

test("routes that require a session reject an unauthenticated request", async () => {
  const app = await buildApp();
  try {
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: headers() });
    assert.equal(me.statusCode, 401);
    assert.equal(me.json().code, "AUTH_REQUIRED");

    const projects = await app.inject({ method: "GET", url: "/api/projects", headers: headers() });
    assert.equal(projects.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("login is rate-limited per IP", async () => {
  const app = await buildApp();
  try {
    const { email } = await makeUser();
    let sawTooManyRequests = false;
    for (let i = 0; i < 12; i++) {
      const res = await login(app, email, "definitely wrong");
      if (res.res.statusCode === 429) {
        sawTooManyRequests = true;
        break;
      }
      assert.equal(res.res.statusCode, 401);
    }
    assert.ok(sawTooManyRequests, "12 rapid login attempts never hit the 10/minute limit");
  } finally {
    await app.close();
  }
});

test("logout clears the session — the cookie no longer authenticates", async () => {
  const app = await buildApp();
  try {
    const { email, password } = await makeUser();
    const { cookie } = await login(app, email, password);
    assert.ok(cookie);

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: headers({ cookie: cookie! }) });
    assert.equal(logout.statusCode, 200);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: headers({ cookie: cookie! }) });
    assert.equal(me.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("project CRUD: create requires auth, an owner gets administrator, a stranger sees nothing", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const stranger = await makeUser();
    const ownerLogin = await login(app, owner.email, owner.password);
    const strangerLogin = await login(app, stranger.email, stranger.password);

    const unauth = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: headers(),
      payload: { name: "No session" },
    });
    assert.equal(unauth.statusCode, 401);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: headers({ cookie: ownerLogin.cookie! }),
      payload: { name: "Owner's project" },
    });
    assert.equal(created.statusCode, 201);
    const project = created.json();
    assert.equal(project.permission, "administrator");

    // No teams assigned yet — every logged-in user defaults to `view`, so a
    // stranger *can* see it in their list (this is the "open by default"
    // behaviour `permissions.ts` documents), just not administer it.
    const list = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: headers({ cookie: strangerLogin.cookie! }),
    });
    assert.equal(list.statusCode, 200);
    const seen = list.json().find((p: { id: string }) => p.id === project.id);
    assert.equal(seen?.permission, "view");

    // A `view` grant can read the project but not rename or delete it.
    const strangerRename = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}`,
      headers: headers({ cookie: strangerLogin.cookie! }),
      payload: { name: "Hijacked" },
    });
    assert.equal(strangerRename.statusCode, 403);

    const strangerDelete = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}`,
      headers: headers({ cookie: strangerLogin.cookie! }),
    });
    assert.equal(strangerDelete.statusCode, 403);

    // The owner can do both.
    const ownerRename = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}`,
      headers: headers({ cookie: ownerLogin.cookie! }),
      payload: { name: "Renamed" },
    });
    assert.equal(ownerRename.statusCode, 200);
    assert.equal(ownerRename.json().name, "Renamed");

    const ownerDelete = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}`,
      headers: headers({ cookie: ownerLogin.cookie! }),
    });
    assert.equal(ownerDelete.statusCode, 200);

    const gone = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: headers({ cookie: ownerLogin.cookie! }),
    });
    assert.equal(gone.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("GET /api/audit is admin-only", async () => {
  const app = await buildApp();
  try {
    const plain = await makeUser();
    const admin = await makeUser({ isAdmin: 1 });
    const plainLogin = await login(app, plain.email, plain.password);
    const adminLogin = await login(app, admin.email, admin.password);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/audit",
      headers: headers({ cookie: plainLogin.cookie! }),
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().code, "ADMIN_REQUIRED");

    const allowed = await app.inject({
      method: "GET",
      url: "/api/audit",
      headers: headers({ cookie: adminLogin.cookie! }),
    });
    assert.equal(allowed.statusCode, 200);
    assert.ok(Array.isArray(allowed.json()));
  } finally {
    await app.close();
  }
});

test("GET /api/metrics returns Prometheus text with the expected gauges, no auth required", async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: "GET", url: "/api/metrics" });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] as string, /^text\/plain/);
    assert.match(res.body, /^# HELP athanordb_uptime_seconds/m);
    assert.match(res.body, /^athanordb_rooms_active \d+$/m);
    assert.match(res.body, /^athanordb_ws_connections_active \d+$/m);
    assert.match(res.body, /^athanordb_errors_total\{source="server"\} \d+$/m);
    assert.match(res.body, /^athanordb_errors_total\{source="client"\} \d+$/m);
  } finally {
    await app.close();
  }
});

test("POST /api/errors/client records a client-reported error, then GET /api/errors (admin-only) lists it", async () => {
  const app = await buildApp();
  try {
    const plain = await makeUser();
    const admin = await makeUser({ isAdmin: 1 });
    const plainLogin = await login(app, plain.email, plain.password);
    const adminLogin = await login(app, admin.email, admin.password);

    const unauth = await app.inject({
      method: "POST",
      url: "/api/errors/client",
      headers: headers(),
      payload: { message: "boom" },
    });
    assert.equal(unauth.statusCode, 401);

    const missingMessage = await app.inject({
      method: "POST",
      url: "/api/errors/client",
      headers: headers({ cookie: plainLogin.cookie! }),
      payload: {},
    });
    assert.equal(missingMessage.statusCode, 400);
    assert.equal(missingMessage.json().code, "CLIENT_ERROR_MESSAGE_REQUIRED");

    const reported = await app.inject({
      method: "POST",
      url: "/api/errors/client",
      headers: headers({ cookie: plainLogin.cookie! }),
      payload: { message: "canvas crashed", stack: "at Foo.render", context: "route:/project/abc" },
    });
    assert.equal(reported.statusCode, 204);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/errors",
      headers: headers({ cookie: plainLogin.cookie! }),
    });
    assert.equal(forbidden.statusCode, 403);

    const listed = await app.inject({
      method: "GET",
      url: "/api/errors",
      headers: headers({ cookie: adminLogin.cookie! }),
    });
    assert.equal(listed.statusCode, 200);
    const entries = listed.json() as { source: string; message: string; userEmail: string | null }[];
    const mine = entries.find((e) => e.message === "canvas crashed");
    assert.ok(mine, "the reported error should be listed");
    assert.equal(mine!.source, "client");
    assert.equal(mine!.userEmail, plain.email);

    const filtered = await app.inject({
      method: "GET",
      url: "/api/errors?source=server",
      headers: headers({ cookie: adminLogin.cookie! }),
    });
    assert.equal(filtered.statusCode, 200);
    assert.ok((filtered.json() as { source: string }[]).every((e) => e.source === "server"));

    const invalidSource = await app.inject({
      method: "GET",
      url: "/api/errors?source=bogus",
      headers: headers({ cookie: adminLogin.cookie! }),
    });
    assert.equal(invalidSource.statusCode, 400);
    assert.equal(invalidSource.json().code, "ERROR_LOG_SOURCE_INVALID");
  } finally {
    await app.close();
  }
});
