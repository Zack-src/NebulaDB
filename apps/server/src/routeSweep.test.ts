import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./infrastructure/testDatabase.js";

/**
 * Sweeps every registered route the way an attacker (or a bug) would hit it: with no session, with a
 * member's session on administrator routes, with an API key outside `/api/v1`, and with hostile bodies.
 * Written to find problems nobody listed: any 2xx where there should be a refusal, any 5xx anywhere.
 */
await useTestDatabase("routesweep");
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
const { after } = await import("node:test");
void after(async () => {
  await closeAllRooms();
  await app.close();
});

interface Route {
  method: string;
  path: string;
}

/** Walks the tree `printRoutes` draws, rebuilding each full path. */
function routes(): Route[] {
  const out: Route[] = [];
  const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false, includeMeta: false }).split("\n")) {
    const match = /^((?:│   |    )*)(?:├── |└── )(.*?) \(([A-Z, ]+)\)$/.exec(line);
    if (!match) continue;
    const depth = match[1].length / 4;
    stack.length = depth;
    stack[depth] = match[2];
    const path = stack.join("");
    for (const method of match[3].split(", "))
      if (method !== "HEAD" && method !== "OPTIONS") out.push({ method, path });
  }
  return out;
}

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, () => randomUUID()).replace(/\*/g, "x");
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function user(isAdmin: 0 | 1) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)")
    .run(id, email, await hashPassword(PASSWORD), isAdmin);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const ALL = routes();

/** Routes that are public on purpose. */
const PUBLIC = [
  /^\/api\/health$/,
  /^\/api\/auth\/(login|features|password-reset\/.*|sso\/.*)$/,
  /^\/api\/auth\/login\/totp$/,
  /^\/api\/share\//,
  /^\/api\/invitations\/[^/]+(\/accept)?$/,
  /^\/api\/v1\/openapi\.json$/,
  /^\/(invite|reset-password|project|share|ws)\b/,
  /^\/api\/auth\/logout$/,
  /^\/api\/metrics$/,
  // A static list of the scopes a key can have.
  /^\/api\/keys\/scopes$/,
  /^\/ws\//,
];
const isPublic = (path: string) => PUBLIC.some((re) => re.test(path));

let sent = 0;
/** A new client address every 100 requests, so the rate limit (which works) does not hide what is being looked at. */
const nextAddress = () => `10.${Math.floor(sent / 60000) % 250}.${Math.floor(sent / 250) % 250}.${(sent++ % 250) + 1}`;

async function hit(route: Route, extra: Record<string, string> = {}, payload?: unknown) {
  return app.inject({
    remoteAddress: nextAddress(),
    method: route.method as "GET",
    url: concrete(route.path),
    headers: headers(extra),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

test("the route list was read", () => {
  assert.ok(ALL.length > 250, `only ${ALL.length} routes found`);
});

test("no route answers 2xx or 5xx to a request with no session, except the public ones", async () => {
  const bad: string[] = [];
  for (const route of ALL) {
    if (isPublic(route.path)) continue;
    const res = await hit(route, {}, ["POST", "PUT", "PATCH"].includes(route.method) ? {} : undefined);
    if (res.statusCode < 400 || res.statusCode >= 500) bad.push(`${route.method} ${route.path} -> ${res.statusCode}`);
  }
  assert.deepEqual(bad, []);
});

test("a member (not an administrator) is refused on every administrator route", async () => {
  const member = await user(0);
  const bad: string[] = [];
  for (const route of ALL.filter((r) => /^\/api\/admin\//.test(r.path))) {
    const res = await hit(
      route,
      { cookie: member.cookie },
      ["POST", "PUT", "PATCH"].includes(route.method) ? {} : undefined,
    );
    if (res.statusCode !== 403 && res.statusCode !== 401)
      bad.push(`${route.method} ${route.path} -> ${res.statusCode}`);
  }
  assert.deepEqual(bad, []);
});

test("an API key is refused on every route outside /api/v1 (even an administrator's, with every scope)", async () => {
  const admin = await user(1);
  const key = await createApiKey(admin.id, "sweep", ["projects:read", "projects:write", "history:read"] as never, null);
  const auth = { authorization: `Bearer ${key.plaintextKey}` };
  const allowed = [/^\/api\/v1\//, /^\/api\/health$/, /^\/api\/auth\/(login|features|password-reset|sso)/];
  // A 400/404 can only come after the authentication step, so the key got through.
  const throughAuth: string[] = [];
  for (const route of ALL) {
    if (allowed.some((re) => re.test(route.path)) || isPublic(route.path) || route.path === "/*" || route.path === "*")
      continue;
    const res = await hit(route, auth, ["POST", "PUT", "PATCH"].includes(route.method) ? {} : undefined);
    if (res.statusCode !== 401 && res.statusCode !== 403)
      throughAuth.push(`${route.method} ${route.path} -> ${res.statusCode} ${res.body.slice(0, 80)}`);
  }
  assert.deepEqual(throughAuth, [], "these routes let an API key past authentication");
});

test("no route answers 5xx to hostile bodies and parameters, signed in as an administrator", async () => {
  const admin = await user(1);
  const bodies: unknown[] = [
    {},
    [],
    null,
    "str",
    { name: null, id: {}, url: 5, email: [], sql: {}, password: {} },
    { __proto__: { isAdmin: true }, constructor: { prototype: { polluted: 1 } } },
    { name: "x".repeat(100_000) },
    { name: "\u0000\ud800", source: "\u0000" },
  ];
  const bad: string[] = [];
  for (const route of ALL) {
    if (route.path.startsWith("/ws") || /\/(logout|backups\/.*restore)/.test(route.path)) continue;
    if (/\/api\/admin\/(shutdown|restart)/.test(route.path)) continue;
    for (const body of ["POST", "PUT", "PATCH", "DELETE"].includes(route.method) ? bodies : [undefined]) {
      let res;
      try {
        res = await app.inject({
          method: route.method as "GET",
          url: concrete(route.path),
          headers: headers({ cookie: admin.cookie, "content-type": "application/json" }),
          ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
        });
      } catch (err) {
        bad.push(`${route.method} ${route.path} threw ${(err as Error).message}`);
        continue;
      }
      if (res.statusCode >= 500 && res.statusCode !== 503)
        bad.push(
          `${route.method} ${route.path} ${JSON.stringify(body)?.slice(0, 40)} -> ${res.statusCode} ${res.body.slice(0, 120)}`,
        );
    }
  }
  assert.deepEqual(bad, []);
});

test("malformed JSON and wrong content types are 4xx, never 5xx", async () => {
  const admin = await user(1);
  const bad: string[] = [];
  for (const [contentType, payload] of [
    ["application/json", "{not json"],
    ["application/json", '{"a":'],
    ["text/plain", "hello"],
    ["application/x-www-form-urlencoded", "a=b"],
    ["application/json", Buffer.alloc(10, 0xff)],
  ] as const) {
    for (const url of ["/api/projects", "/api/auth/login", "/api/keys", "/api/teams", "/api/invitations"]) {
      const res = await app.inject({
        method: "POST",
        url,
        headers: headers({ cookie: admin.cookie, "content-type": contentType }),
        payload: payload as string,
      });
      // 503 is a feature this instance does not have (no e-mail for a password reset), not a fault.
      if (res.statusCode >= 500 && res.statusCode !== 503)
        bad.push(`${url} ${contentType} -> ${res.statusCode} ${res.body.slice(0, 100)}`);
    }
  }
  assert.deepEqual(bad, []);
});
