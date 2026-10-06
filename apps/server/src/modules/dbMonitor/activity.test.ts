import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DbAdminSession } from "@nebuladb/shared";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-activity-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("../connections/connectionBudget.js");
const { activityReader, purgeOldActivity, runDueActivitySamples } = await import("./activity.js");

type App = Awaited<ReturnType<typeof buildApp>>;

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function makeUser(app: App, isAdmin: 0 | 1) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    randomUUID(),
    email,
    await hashPassword(password),
    isAdmin,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const session = (over: Partial<DbAdminSession>): DbAdminSession => ({
  id: "1",
  user: "someone",
  database: "shop",
  client: "10.0.0.5",
  state: "active",
  query: null,
  durationSeconds: 0,
  ...over,
});

test("database-side activity: sampled, masked, grouped, and told apart by account", async () => {
  const app = await buildApp();
  const read = mock.method(activityReader, "read");
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app, 0);
    const connection = (
      await call(app, admin, "POST", "/api/admin/connections", {
        name: "Shop",
        engine: "postgres",
        host: "127.0.0.1",
        port: 1,
        database: "shop",
        user: "nebula_service",
        password: "service-password",
      })
    ).json().connection as { id: string };
    const url = `/api/admin/connections/${connection.id}/activity`;

    assert.equal((await call(app, member, "GET", url)).statusCode, 403);
    assert.equal((await call(app, member, "POST", `${url}/sample`)).statusCode, 403);
    assert.deepEqual((await call(app, admin, "GET", url)).json().entries, []);

    read.mock.mockImplementation(async () => [
      session({ id: "1", user: "nebula_service", query: "SELECT 1" }),
      session({
        id: "2",
        user: "report_bot",
        query: "SELECT * FROM orders WHERE customer = 'Ada' AND id = 42",
        durationSeconds: 7,
      }),
      session({ id: "3", user: "report_bot", client: "10.0.0.9", state: "idle" }),
    ]);
    assert.equal((await call(app, admin, "POST", `${url}/sample`)).json().sessions, 3);
    // The same statement from the same account again, with other literals: one line, seen twice.
    read.mock.mockImplementation(async () => [
      session({
        id: "2",
        user: "report_bot",
        query: "SELECT * FROM orders WHERE customer = 'Grace' AND id = 43",
        durationSeconds: 3,
      }),
    ]);
    await call(app, admin, "POST", `${url}/sample`);

    const all = (await call(app, admin, "GET", url)).json().entries as {
      user: string;
      sql: string;
      seen: number;
      maxSeconds: number;
      knownAccount: boolean;
    }[];
    assert.equal(all.length, 3);
    const orders = all.find((e) => e.sql.includes("orders"))!;
    assert.equal(orders.seen, 2);
    assert.equal(orders.maxSeconds, 7);
    assert.equal(orders.sql.includes("Ada") || orders.sql.includes("42"), false, "no literal is kept");
    assert.equal(all.find((e) => e.user === "nebula_service")!.knownAccount, true);
    assert.equal(orders.knownAccount, false);
    // A session with no statement is still listed, with an empty shape.
    assert.ok(all.some((e) => e.sql === "" && e.user === "report_bot"));

    const outside = (await call(app, admin, "GET", `${url}?outside=1`)).json().entries as { user: string }[];
    assert.deepEqual([...new Set(outside.map((e) => e.user))], ["report_bot"]);

    // Scheduled: only when asked, and a failure is noted without stopping anything.
    const before = read.mock.callCount();
    await runDueActivitySamples();
    assert.equal(read.mock.callCount(), before, "not sampled unless watched");
    const watch = await call(app, admin, "PUT", `${url}/watch`, { enabled: true });
    assert.equal(watch.json().enabled, true);
    db.prepare(
      "UPDATE db_activity_watch SET last_sampled_at = datetime('now', '-10 minutes') WHERE connection_id = ?",
    ).run(connection.id);
    read.mock.mockImplementation(async () => {
      throw new Error("server unreachable");
    });
    await runDueActivitySamples();
    const noted = (await call(app, admin, "GET", url)).json().watch;
    assert.equal(noted.enabled, true);
    assert.match(noted.lastError, /server unreachable/);

    // Retention and cleanup.
    db.prepare("UPDATE db_activity SET day = date('now', '-30 days')").run();
    assert.ok(purgeOldActivity(14) > 0);
    assert.deepEqual((await call(app, admin, "GET", `${url}?days=60`)).json().entries, []);
  } finally {
    read.mock.restore();
    closeAllRooms();
    await app.close();
  }
});

test("server traffic: differences between counter reads, a restart skipped, missing counters left empty", async () => {
  const app = await buildApp();
  const read = mock.method(activityReader, "read", async () => []);
  const counters = mock.method(activityReader, "counters");
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const connection = (
      await call(app, admin, "POST", "/api/admin/connections", {
        name: "Shop",
        engine: "mysql",
        host: "127.0.0.1",
        port: 1,
        database: "shop",
        user: "svc",
        password: "pw",
      })
    ).json().connection as { id: string };
    const url = `/api/admin/connections/${connection.id}/activity`;
    const reads = [
      { queries: 100, bytesOut: 1000, bytesIn: 500, rows: null },
      { queries: 160, bytesOut: 2500, bytesIn: 800, rows: null },
      // The server restarted: counters start over, that step is not a negative traffic.
      { queries: 10, bytesOut: 50, bytesIn: 20, rows: null },
      { queries: 40, bytesOut: 450, bytesIn: 120, rows: null },
    ];
    for (const [i, value] of reads.entries()) {
      counters.mock.mockImplementation(async () => ({ queriesKind: "statements" as const, ...value }));
      await call(app, admin, "POST", `${url}/sample`);
      // Samples are seconds apart in a test: spread them over distinct hours of today.
      db.prepare(
        "UPDATE db_counter_samples SET taken_at = datetime('now', ?) WHERE connection_id = ? AND taken_at = (SELECT MAX(taken_at) FROM db_counter_samples WHERE connection_id = ?)",
      ).run(`-${(reads.length - i) * 2} hours`, connection.id, connection.id);
    }
    const traffic = (await call(app, admin, "GET", `${url}/traffic?days=1`)).json() as {
      kind: string;
      buckets: { queries: number | null; bytesOut: number | null; rows: number | null }[];
    };
    assert.equal(traffic.kind, "statements");
    const total = (field: "queries" | "bytesOut") => traffic.buckets.reduce((sum, b) => sum + (b[field] ?? 0), 0);
    assert.equal(total("queries"), 60 + 30, "60 then (restart skipped) 30");
    assert.equal(total("bytesOut"), 1500 + 400);
    assert.ok(
      traffic.buckets.every((b) => b.rows === null),
      "a counter the engine lacks stays empty",
    );

    assert.equal((await call(app, admin, "GET", `${url}/traffic?days=0`)).statusCode, 400);
    // An engine with no counters does not fail the sample.
    counters.mock.mockImplementation(async () => {
      throw new Error("unsupported");
    });
    assert.equal((await call(app, admin, "POST", `${url}/sample`)).statusCode, 200);
  } finally {
    read.mock.restore();
    counters.mock.restore();
    closeAllRooms();
    await app.close();
  }
});

test("health board: a fresh probe, the latency series, the parts the server gives", async () => {
  const { healthReader } = await import("./healthBoard.js");
  const app = await buildApp();
  const reader = mock.method(healthReader, "read", async () => ({
    databases: [{ name: "shop", sizeBytes: 1024, system: false }],
    sessions: { total: 3, active: 1, idle: 2, longestSeconds: 40, longestUser: "bot" },
    blocking: [{ blocked: "7", blocker: "3" }],
  }));
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app, 0);
    const connection = (
      await call(app, admin, "POST", "/api/admin/connections", {
        name: "Down",
        engine: "postgres",
        host: "127.0.0.1",
        port: 1,
        database: "shop",
        user: "svc",
        password: "pw",
      })
    ).json().connection as { id: string };
    const url = `/api/admin/connections/${connection.id}/health-board`;
    assert.equal((await call(app, member, "GET", url)).statusCode, 403);
    assert.equal((await call(app, admin, "GET", "/api/admin/connections/nope/health-board")).statusCode, 404);

    // Nothing answers: offline, the error says why, and the server is not asked for more.
    const down = (await call(app, admin, "GET", url)).json();
    assert.equal(down.status.ok, false);
    assert.ok(down.status.error);
    assert.equal(down.sessions, null);
    assert.equal(reader.mock.callCount(), 0);
    assert.equal(down.history.length, 1);
    assert.equal(down.history[0].ok, false);

    // Each probe adds a point; an online server gives its parts.
    db.prepare("UPDATE db_connections SET last_status = 'online' WHERE id = ?").run(connection.id);
    const again = (await call(app, admin, "GET", url)).json();
    assert.equal(again.history.length, 2);
    assert.equal(again.status.ok, false, "the probe is what decides, not the stored status");
  } finally {
    reader.mock.restore();
    closeAllRooms();
    await app.close();
  }
});
