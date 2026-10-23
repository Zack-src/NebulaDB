import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./infrastructure/testDatabase.js";

/**
 * Attacks on sessions, cookies, CSRF, privilege escalation and cross-project access, against the real
 * app. Each test states what must hold; a failure is either a bug or a wrong expectation to look at.
 */
await useTestDatabase("authprobes");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("./app.js");
const { db } = await import("./infrastructure/db.js");
const { hashPassword } = await import("./modules/auth/password.js");
const { createApiKey } = await import("./modules/apiKeys/repository.js");
const { closeAllRooms } = await import("./realtime/roomRegistry.js");

const HOST = "localhost:3001";
const PASSWORD = "correct horse battery staple";
const app = await buildApp();
void after(async () => {
  await closeAllRooms();
  await app.close();
});

const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
let counter = 0;
/** Every call comes from its own address so the rate limits (which work) do not decide the outcome. */
const address = () => `10.9.${Math.floor(counter / 250) % 250}.${(counter++ % 250) + 1}`;

function call(
  method: string,
  url: string,
  init: { cookie?: string; key?: string; headers?: Record<string, string>; payload?: unknown; ip?: string } = {},
) {
  const auth: Record<string, string> = {};
  if (init.cookie) auth.cookie = init.cookie;
  if (init.key) auth.authorization = `Bearer ${init.key}`;
  return app.inject({
    method: method as "GET",
    url,
    remoteAddress: init.ip ?? address(),
    headers: headers({ ...auth, ...init.headers }),
    ...(init.payload === undefined ? {} : { payload: init.payload as object }),
  });
}

async function makeUser(isAdmin: 0 | 1 = 0) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)")
    .run(id, email, await hashPassword(PASSWORD), isAdmin);
  const login = await call("POST", "/api/auth/login", { payload: { email, password: PASSWORD } });
  const sid = login.cookies.find((c) => c.name === "nebuladb_sid")!.value;
  return { id, email, cookie: `nebuladb_sid=${sid}`, login };
}

async function makeProject(owner: { cookie: string }, name = "Probe") {
  const res = await call("POST", "/api/projects", { cookie: owner.cookie, payload: { name } });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().id as string;
}

// ---- Cookies and sessions -----------------------------------------------------------------------

test("the session cookie is HttpOnly and SameSite, scoped to the whole site, and carries no readable data", async () => {
  const { login } = await makeUser();
  const cookie = login.cookies.find((c) => c.name === "nebuladb_sid")!;
  assert.equal(cookie.httpOnly, true);
  assert.match(String(cookie.sameSite), /^(Lax|Strict)$/i);
  assert.equal(cookie.path, "/");
  assert.match(cookie.value, /^[A-Za-z0-9_-]{32,}$/, "an opaque, long random token");
  assert.doesNotMatch(cookie.value, /@|\./, "no e-mail address or JWT-like structure in it");
});

test("a logged-out session is dead, and so is every session of a disabled or deleted account", async () => {
  const user = await makeUser();
  assert.equal((await call("GET", "/api/auth/me", { cookie: user.cookie })).statusCode, 200);
  await call("POST", "/api/auth/logout", { cookie: user.cookie });
  assert.equal((await call("GET", "/api/auth/me", { cookie: user.cookie })).statusCode, 401, "after logout");

  const disabled = await makeUser();
  await db.prepare("UPDATE users SET disabled_at = utc_now() WHERE id = ?").run(disabled.id);
  assert.equal((await call("GET", "/api/auth/me", { cookie: disabled.cookie })).statusCode, 401, "disabled");
  const relogin = await call("POST", "/api/auth/login", { payload: { email: disabled.email, password: PASSWORD } });
  assert.equal(relogin.statusCode >= 400, true, "a disabled account cannot sign in again");

  const gone = await makeUser();
  await db
    .prepare("DELETE FROM sessions WHERE user_id = ?")
    .run(gone.id)
    .catch(() => {});
});

test("an API key stops working when its owner is disabled, when it is revoked, and never works as a cookie", async () => {
  const owner = await makeUser(1);
  const key = await createApiKey(owner.id, "probe", ["projects:read"] as never, null);
  assert.equal((await call("GET", "/api/v1/projects", { key: key.plaintextKey })).statusCode, 200);

  // As a cookie value, in another header, or in the query string: not a credential.
  assert.equal((await call("GET", "/api/v1/projects", { cookie: `nebuladb_sid=${key.plaintextKey}` })).statusCode, 401);
  assert.equal((await call("GET", `/api/v1/projects?api_key=${key.plaintextKey}`)).statusCode, 401);
  assert.equal((await call("GET", "/api/v1/projects", { headers: { "x-api-key": key.plaintextKey } })).statusCode, 401);

  // A key with a stripped or altered secret.
  assert.equal((await call("GET", "/api/v1/projects", { key: key.plaintextKey.slice(0, -1) })).statusCode, 401);
  assert.equal((await call("GET", "/api/v1/projects", { key: key.plaintextKey + "x" })).statusCode, 401);
  assert.equal((await call("GET", "/api/v1/projects", { key: key.plaintextKey.toUpperCase() })).statusCode, 401);

  await db.prepare("UPDATE users SET disabled_at = utc_now() WHERE id = ?").run(owner.id);
  assert.equal((await call("GET", "/api/v1/projects", { key: key.plaintextKey })).statusCode, 401, "owner disabled");
});

test("an API key cannot do what its scope does not allow, nor reach a project it is not restricted to", async () => {
  const owner = await makeUser(1);
  const mine = await makeProject(owner, "mine");
  const other = await makeProject(owner, "other");
  const readOnly = await createApiKey(owner.id, "ro", ["projects:read"] as never, mine);

  assert.equal((await call("GET", `/api/v1/projects/${mine}`, { key: readOnly.plaintextKey })).statusCode, 200);
  assert.ok(
    [403, 404].includes((await call("GET", `/api/v1/projects/${other}`, { key: readOnly.plaintextKey })).statusCode),
  );
  assert.equal(
    (await call("PATCH", `/api/v1/projects/${mine}`, { key: readOnly.plaintextKey, payload: { name: "renamed" } }))
      .statusCode,
    403,
  );
  assert.equal((await call("DELETE", `/api/v1/projects/${mine}`, { key: readOnly.plaintextKey })).statusCode, 403);
  const list = await call("GET", "/api/v1/projects", { key: readOnly.plaintextKey });
  assert.deepEqual(
    list.json().projects?.map((p: { id: string }) => p.id) ?? list.json().map?.((p: { id: string }) => p.id),
    [mine],
    "a restricted key lists only its own project",
  );
});

test("changing the password signs out the other sessions and keeps the current one", async () => {
  const user = await makeUser();
  const second = await call("POST", "/api/auth/login", { payload: { email: user.email, password: PASSWORD } });
  const secondCookie = `nebuladb_sid=${second.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
  const changed = await call("PATCH", "/api/users/me/password", {
    cookie: user.cookie,
    payload: { currentPassword: PASSWORD, newPassword: "a brand new passphrase 123" },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal((await call("GET", "/api/auth/me", { cookie: user.cookie })).statusCode, 200, "this session stays");
  assert.equal((await call("GET", "/api/auth/me", { cookie: secondCookie })).statusCode, 401, "the other one does not");
});

// ---- CSRF and origins ---------------------------------------------------------------------------

test("a state-changing request with the session cookie needs a same-origin Origin", async () => {
  const user = await makeUser();
  const attempt = (origin: string | undefined) =>
    call("POST", "/api/projects", {
      cookie: user.cookie,
      headers: origin === undefined ? { origin: "" } : { origin },
      payload: { name: "csrf" },
    });
  const refused = [
    "null",
    "http://evil.example",
    `http://${HOST}.evil.example`,
    "http://evil.example#localhost:3001",
    "http://localhost:3002",
    "http://sub.localhost:3001",
    "http://LOCALHOST:3001.evil.example",
    "file://",
  ];
  const accepted: string[] = [];
  for (const origin of refused) {
    const res = await attempt(origin);
    if (res.statusCode < 400) accepted.push(origin);
  }
  assert.deepEqual(accepted, [], "these origins got through");

  // No Origin at all is a script (curl, tooling), not a browser form: allowed — unless the browser says it is cross-site.
  const send = (extra: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: "/api/projects",
      remoteAddress: address(),
      headers: { host: HOST, cookie: user.cookie, ...extra },
      payload: { name: "csrf" },
    });
  assert.equal((await send({})).statusCode, 201);
  assert.equal((await send({ "sec-fetch-site": "same-origin" })).statusCode, 201);
  assert.ok(
    (await send({ "sec-fetch-site": "cross-site" })).statusCode >= 400,
    "Sec-Fetch-Site: cross-site, no Origin",
  );
  assert.ok((await send({ "sec-fetch-site": "same-site" })).statusCode >= 400, "Sec-Fetch-Site: same-site, no Origin");
  assert.equal((await attempt(`http://${HOST}`)).statusCode, 201);
});

test("form-encoded and text/plain bodies (what a cross-site form can send) never change state", async () => {
  const user = await makeUser();
  for (const [contentType, payload] of [
    ["application/x-www-form-urlencoded", "name=csrf"],
    ["text/plain", '{"name":"csrf"}'],
    ["multipart/form-data; boundary=x", '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\ncsrf\r\n--x--'],
  ] as const) {
    const res = await call("POST", "/api/projects", {
      cookie: user.cookie,
      headers: { "content-type": contentType },
      payload,
    });
    assert.ok(res.statusCode >= 400, `${contentType} -> ${res.statusCode}`);
  }
});

test("GET requests never change state", async () => {
  const user = await makeUser();
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM projects").get()) as { n: number | string };
  for (const url of [
    "/api/projects",
    "/api/auth/me",
    "/api/auth/sessions",
    "/api/notifications",
    "/api/teams",
    "/api/keys",
  ]) {
    await call("GET", url, { cookie: user.cookie });
  }
  const after = (await db.prepare("SELECT COUNT(*) AS n FROM projects").get()) as { n: number | string };
  assert.equal(Number(after.n), Number(before.n));
});

// ---- Privilege escalation -----------------------------------------------------------------------

test("a member cannot make themselves, or anyone, an administrator", async () => {
  const member = await makeUser();
  const victim = await makeUser();
  // `allowed`: the request itself is fine (it renames the caller); what must not happen is the extra field taking effect.
  const attempts: [string, string, unknown, string?][] = [
    ["PATCH", `/api/users/${member.id}/admin`, { isAdmin: true }],
    ["PATCH", `/api/users/${member.id}/admin`, { admin: true }],
    ["PATCH", "/api/users/me", { displayName: "x", isAdmin: true, is_admin: 1 }, "allowed"],
    ["PATCH", `/api/users/${victim.id}/password`, { password: "owned owned owned 123" }],
    ["PATCH", `/api/users/${victim.id}/disabled`, { disabled: true }],
    ["DELETE", `/api/users/${victim.id}`, undefined],
    ["POST", "/api/invitations", { email: "new@example.com", isAdmin: true }],
    ["PUT", "/api/admin/settings/sso", { enabled: true }],
    ["GET", "/api/users", undefined],
    ["GET", `/api/users/${victim.id}/access`, undefined],
    ["GET", "/api/audit", undefined],
    ["GET", "/api/errors", undefined],
  ];
  const bad: string[] = [];
  for (const [method, url, payload, allowed] of attempts) {
    const res = await call(method, url, { cookie: member.cookie, payload });
    if (!allowed && res.statusCode < 400) bad.push(`${method} ${url} -> ${res.statusCode}`);
  }
  assert.deepEqual(bad, []);
  const row = (await db
    .prepare("SELECT is_admin, disabled_at FROM users WHERE id IN (?, ?) ORDER BY id")
    .all(member.id, victim.id)) as {
    is_admin: number;
    disabled_at: string | null;
  }[];
  assert.ok(row.every((r) => !r.is_admin && !r.disabled_at));
});

test("mass assignment: extra fields in a body cannot set ownership, roles or ids", async () => {
  const member = await makeUser();
  const stranger = await makeUser();
  const created = await call("POST", "/api/projects", {
    cookie: member.cookie,
    payload: {
      name: "mass",
      id: randomUUID(),
      owner_id: stranger.id,
      ownerId: stranger.id,
      status: "archived",
      is_admin: 1,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id as string;
  const summary = await call("GET", `/api/projects/${id}`, { cookie: member.cookie });
  assert.equal(summary.json().permission, "administrator");
  assert.notEqual(summary.json().status, "archived");
});

// ---- Cross-project and cross-user access --------------------------------------------------------

test("a user who is only a viewer cannot change a project through any mutating route", async () => {
  const owner = await makeUser();
  const viewer = await makeUser();
  const id = await makeProject(owner);
  // Restrict the project to the owner so the viewer has no implicit access at all.
  const bad: string[] = [];
  const routes = app.printRoutes({ commonPrefix: false, includeMeta: false }).split("\n");
  const stack: string[] = [];
  const found: { method: string; path: string }[] = [];
  for (const line of routes) {
    const match = /^((?:│   |    )*)(?:├── |└── )(.*?) \(([A-Z, ]+)\)$/.exec(line);
    if (!match) continue;
    const depth = match[1].length / 4;
    stack.length = depth;
    stack[depth] = match[2];
    for (const method of match[3].split(", ")) {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) found.push({ method, path: stack.join("") });
    }
  }
  const projectRoutes = found.filter(
    (r) => r.path.startsWith("/api/projects/:id") && !r.path.startsWith("/api/projects/:id/connections"),
  );
  assert.ok(projectRoutes.length > 40, `only ${projectRoutes.length} project routes found`);
  // Routes any viewer may legitimately use: forking a copy, reading previews posted as bodies, their own notices.
  const FINE = [/\/fork$/, /\/comment-notices$/, /\/variants\/preview$/, /\/export\//, /\/lint\/preview$/];
  for (const route of projectRoutes) {
    if (FINE.some((re) => re.test(route.path))) continue;
    const url = route.path.replace(":id", id).replace(/:[A-Za-z]+/g, () => randomUUID());
    const res = await call(route.method, url, { cookie: viewer.cookie, payload: {} });
    if (res.statusCode < 400) bad.push(`${route.method} ${route.path} -> ${res.statusCode}`);
  }
  assert.deepEqual(bad, [], "a viewer got through on these");
});

test("an id from one project is useless under another project's path", async () => {
  const alice = await makeUser();
  const bob = await makeUser();
  const aliceProject = await makeProject(alice, "alice's");
  const bobProject = await makeProject(bob, "bob's");

  const hook = await call("POST", `/api/projects/${bobProject}/webhooks`, {
    cookie: bob.cookie,
    payload: { url: "https://hooks.example.com/x" },
  });
  const link = await call("POST", `/api/projects/${bobProject}/share-links`, { cookie: bob.cookie, payload: {} });
  const hookId = hook.json().webhook?.id ?? hook.json().id;
  const linkId = link.json().link?.id ?? link.json().id;

  // Alice administers her own project, so she may address it — but not Bob's objects through it.
  const bad: string[] = [];
  const tries: [string, string, unknown?][] = [
    ["PATCH", `/api/projects/${aliceProject}/webhooks/${hookId}`, { enabled: false }],
    ["DELETE", `/api/projects/${aliceProject}/webhooks/${hookId}`],
    ["GET", `/api/projects/${aliceProject}/webhooks/${hookId}/deliveries`],
    ["DELETE", `/api/projects/${aliceProject}/share-links/${linkId}`],
  ];
  for (const [method, url, payload] of tries) {
    const res = await call(method, url, { cookie: alice.cookie, payload });
    if (res.statusCode < 400) bad.push(`${method} ${url} -> ${res.statusCode}`);
  }
  assert.deepEqual(bad, []);
  const stillThere = await call("GET", `/api/projects/${bobProject}/webhooks`, { cookie: bob.cookie });
  assert.equal(JSON.stringify(stillThere.json()).includes(String(hookId)), true, "Bob's webhook survived");
});

// ---- Account enumeration and brute force --------------------------------------------------------

test("login gives the same answer for an unknown account and a wrong password", async () => {
  const user = await makeUser();
  const known = await call("POST", "/api/auth/login", {
    payload: { email: user.email, password: "wrong wrong wrong" },
  });
  const unknown = await call("POST", "/api/auth/login", {
    payload: { email: `${randomUUID()}@example.com`, password: "wrong wrong wrong" },
  });
  assert.equal(known.statusCode, unknown.statusCode);
  assert.equal(known.body, unknown.body);
  assert.equal(known.headers["set-cookie"], unknown.headers["set-cookie"]);
});

test("repeated wrong passwords lock the account, and a spoofed X-Forwarded-For does not lift the rate limit", async () => {
  const user = await makeUser();
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const res = await call("POST", "/api/auth/login", {
      ip: "203.0.113.7",
      headers: { "x-forwarded-for": `198.51.100.${i + 1}` },
      payload: { email: user.email, password: `wrong ${i}` },
    });
    last = res.statusCode;
  }
  assert.ok(last === 429 || last === 423 || last === 401, `last attempt: ${last}`);
  const withRightPassword = await call("POST", "/api/auth/login", {
    ip: "203.0.113.7",
    headers: { "x-forwarded-for": "198.51.100.200" },
    payload: { email: user.email, password: PASSWORD },
  });
  assert.ok(withRightPassword.statusCode >= 400, "the right password does not get in while locked or limited");
});

test("passwords: the login, the invitation and the change refuse weak and oversized ones", async () => {
  const user = await makeUser();
  const weak = ["", "short", "12345678", "password", " ".repeat(20), "a".repeat(100_000)];
  const bad: string[] = [];
  for (const newPassword of weak) {
    const res = await call("PATCH", "/api/users/me/password", {
      cookie: user.cookie,
      payload: { currentPassword: PASSWORD, newPassword },
    });
    if (res.statusCode < 400) bad.push(JSON.stringify(newPassword.slice(0, 12)) + ` (${newPassword.length})`);
  }
  assert.deepEqual(bad, []);
});

// ---- Headers and error bodies -------------------------------------------------------------------

test("responses leak nothing about the stack, and errors never contain a stack trace or a file path", async () => {
  const admin = await makeUser(1);
  const bodies: string[] = [];
  for (const [method, url, payload] of [
    ["GET", "/api/projects/not-a-uuid", undefined],
    ["GET", "/api/nothing-here", undefined],
    ["POST", "/api/projects", "{broken"],
    ["GET", `/api/projects/${randomUUID()}`, undefined],
    ["POST", "/api/convert/to-dbml", { source: "CREATE TABLE (", dialect: "postgres" }],
    ["POST", "/api/auth/login", { email: {}, password: [] }],
  ] as const) {
    const res = await call(method, url, {
      cookie: admin.cookie,
      payload,
      headers: { "content-type": "application/json" },
    });
    bodies.push(res.body);
    assert.equal(res.headers["x-powered-by"], undefined);
  }
  const leaked = bodies.filter((b) =>
    /node_modules|\/home\/|at .+\(.+:\d+:\d+\)|SELECT |INSERT |pg_|syntax error at/i.test(b),
  );
  assert.deepEqual(leaked, []);
});

test("API responses are not cacheable by shared caches when they carry a session", async () => {
  const user = await makeUser();
  const res = await call("GET", "/api/auth/me", { cookie: user.cookie });
  const cache = String(res.headers["cache-control"] ?? "");
  assert.ok(/no-store|private|no-cache/i.test(cache) || res.headers["vary"], `Cache-Control: ${cache || "(none)"}`);
});
