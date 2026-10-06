import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-querystats-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { purgeOldQueryStats } = await import("./queryStats.js");
const { normalizeSql } = await import("./sqlShape.js");

test("normalizeSql: every literal becomes ?, names and parameters stay", () => {
  const cases: [string, string, string?][] = [
    [
      "SELECT * FROM users WHERE email = 'ada@example.com' AND id = 42",
      "SELECT * FROM users WHERE email = ? AND id = ?",
    ],
    ["select  name\n from t1 where x=-3.5e2;  ", "select name from t1 where x=-?"],
    ["SELECT 'it''s', N'unicode', E'esc\\'aped', X'0FA' FROM t", "SELECT ?, ?, ?, ? FROM t"],
    ["SELECT * FROM t WHERE id IN (1, 2, 3, 4)", "SELECT * FROM t WHERE id IN (?)"],
    ["INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y'), (3, 'z')", "INSERT INTO t (a, b) VALUES (?)"],
    [
      'SELECT "Col 1", [order], `k2` FROM "Table9" WHERE c = $1 AND d = :p2 AND e = @p3',
      'SELECT "Col 1", [order], `k2` FROM "Table9" WHERE c = $1 AND d = :p2 AND e = @p3',
    ],
    ["SELECT 1 -- secret 'comment'\n/* 'block' 99 */ FROM dual", "SELECT ? FROM dual"],
    ["SELECT $$body 'with' 7$$, $fn$x$fn$, 0x1F", "SELECT ?, ?, ?"],
    ["SELECT q'[it's]' FROM dual", "SELECT ? FROM dual"],
    ['SELECT * FROM t WHERE name = "ada" # note', "SELECT * FROM t WHERE name = ?", "mysql"],
    ["SELECT 'a\\'b' FROM t", "SELECT ? FROM t", "mysql"],
    ["CREATE USER bob IDENTIFIED BY 'hunter2'", "CREATE USER bob IDENTIFIED BY ?"],
  ];
  for (const [sql, expected, engine] of cases) assert.equal(normalizeSql(sql, engine), expected, sql);
  // Same shape, same text: what the statistics group on.
  assert.equal(normalizeSql("SELECT * FROM t WHERE id = 1"), normalizeSql("SELECT  *  FROM t WHERE id = 2;"));
});

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

async function login(app: App, admin: boolean) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    email,
    await hashPassword(password),
    admin ? 1 : 0,
    admin ? "Ada Admin" : "Bob",
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { host: HOST, origin: ORIGIN },
    payload: { email, password },
  });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { host: HOST, origin: ORIGIN, cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

interface Stat {
  sql: string;
  executions: number;
  failures: number;
  avgMs: number;
  maxMs: number;
  totalMs: number;
  avgRows: number | null;
  lastUserName: string | null;
}

test("a database's journal: console opened, statements counted by shape without their values, admin only", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, true);
    const member = await login(app, false);
    const conn = (
      await call(app, admin, "POST", "/api/admin/connections", {
        name: "Local",
        engine: "sqlite",
        filePath: join(mkdtempSync(join(tmpdir(), "nebuladb-stats-")), "shop.sqlite"),
      })
    ).json().connection.id as string;
    const run = (sql: string, readOnly = true) =>
      call(app, admin, "POST", `/api/admin/connections/${conn}/query`, { sql, readOnly });

    // Opening the console and testing the connection are written to its journal.
    assert.equal((await call(app, admin, "GET", `/api/admin/connections/${conn}/overview`)).statusCode, 200);
    assert.equal((await call(app, admin, "POST", `/api/admin/connections/${conn}/health`)).statusCode, 200);

    assert.equal((await run("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)", false)).statusCode, 200);
    for (const [id, label] of [
      [1, "secret-alpha"],
      [2, "secret-beta"],
    ] as const) {
      assert.equal((await run(`INSERT INTO items (id, label) VALUES (${id}, '${label}')`, false)).statusCode, 200);
    }
    for (const id of [1, 2, 3]) assert.equal((await run(`SELECT * FROM items WHERE id = ${id}`)).statusCode, 200);
    assert.notEqual((await run("SELECT * FROM missing WHERE id = 9")).statusCode, 200);

    const stats = (await call(app, admin, "GET", `/api/admin/connections/${conn}/query-stats?days=7`)).json() as {
      stats: Stat[];
    };
    const bySql = new Map(stats.stats.map((s) => [s.sql, s]));
    const select = bySql.get("SELECT * FROM items WHERE id = ?");
    assert.ok(select, JSON.stringify(stats.stats));
    assert.equal(select.executions, 3);
    assert.equal(select.failures, 0);
    assert.equal(select.lastUserName, "Ada Admin");
    assert.ok(select.maxMs >= select.avgMs && select.totalMs >= select.maxMs);
    assert.equal(bySql.get("INSERT INTO items (id, label) VALUES (?)")?.executions, 2);
    assert.equal(bySql.get("SELECT * FROM missing WHERE id = ?")?.failures, 1);
    // Most frequent first; no value typed in a statement is kept.
    assert.equal(stats.stats[0].sql, "SELECT * FROM items WHERE id = ?");
    assert.ok(!JSON.stringify(db.prepare("SELECT * FROM query_stats").all()).includes("secret-"));
    const slowest = (
      await call(app, admin, "GET", `/api/admin/connections/${conn}/query-stats?sort=slowest`)
    ).json() as {
      stats: Stat[];
    };
    assert.equal(slowest.stats.length, stats.stats.length);
    assert.equal(
      (await call(app, admin, "GET", `/api/admin/connections/${conn}/query-stats?sort=random`)).json().code,
      "ACTIVITY_QUERY_INVALID",
    );

    // The journal itself is the activity view filtered on the database.
    const journal = (await call(app, admin, "GET", `/api/admin/activity?connectionId=${conn}`)).json() as {
      entries: { action: string; detail: string | null; category: string }[];
    };
    const actions = journal.entries.map((e) => e.action);
    assert.ok(actions.includes("dbconn.open"));
    assert.ok(actions.includes("dbconn.test"));
    assert.equal(actions.filter((a) => a === "dbadmin.query").length, 7);
    assert.equal(journal.entries.find((e) => e.action === "dbconn.open")?.category, "sessions");
    const actors = (await call(app, admin, "GET", `/api/admin/connections/${conn}/journal/actors`)).json() as {
      actors: { name: string }[];
    };
    assert.deepEqual(
      actors.actors.map((a) => a.name),
      ["Ada Admin"],
    );

    // Instance administrators only.
    for (const url of [`/api/admin/connections/${conn}/query-stats`, `/api/admin/connections/${conn}/journal/actors`]) {
      assert.equal((await call(app, member, "GET", url)).statusCode, 403, url);
    }

    // Retention: a day past it goes, and so does what is left of a deleted connection.
    db.prepare("UPDATE query_stats SET day = date('now', '-40 days') WHERE normalized_sql LIKE 'INSERT%'").run();
    assert.equal(purgeOldQueryStats(30), 1);
    db.prepare(
      "INSERT INTO query_stats (connection_id, query_hash, day, normalized_sql, last_at) VALUES ('gone', 'h', date('now'), 'SELECT ?', datetime('now'))",
    ).run();
    assert.equal(purgeOldQueryStats(0), 1);
  } finally {
    await app.close();
  }
});
