import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DbQueryStat } from "@nebuladb/shared";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("indexsuggest");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { suggestIndexes } = await import("./indexSuggestions.js");
const { readStatement } = await import("./sqlReader.js");

type Catalog = Parameters<typeof suggestIndexes>[1];

function stat(sql: string, executions = 10, totalMs = 1000, failures = 0): DbQueryStat {
  return {
    hash: sql,
    sql,
    executions,
    failures,
    avgMs: Math.round(totalMs / executions),
    maxMs: totalMs,
    totalMs,
    avgRows: 1,
    lastAt: "2026-01-01 00:00:00",
    lastUserName: null,
  };
}

const keyed = (indexes: string[][]) =>
  indexes.map((columns) => ({ columns, unique: columns.length === 1 && columns[0] === "id" }));

const orders = (indexes: string[][] = [["id"]]): Catalog[number] => ({
  schema: "public",
  name: "orders",
  columns: ["id", "customer_id", "status", "created_at", "total"],
  indexes: keyed(indexes),
});
const customers: Catalog[number] = {
  schema: "public",
  name: "customers",
  columns: ["id", "email", "country"],
  indexes: keyed([["id"]]),
};

const columnsOf = (stats: DbQueryStat[], catalog: Catalog, engine: Parameters<typeof suggestIndexes>[2]) =>
  suggestIndexes(stats, catalog, engine).map((s) => `${s.table}(${s.columns.join(",")})`);

test("reader: each engine's quoting, aliases and schema-qualified names", () => {
  const cases: [string, string | undefined, string][] = [
    ['SELECT * FROM "public"."orders" o WHERE o."customer_id" = $1', "postgres", "public.orders:o"],
    ["SELECT * FROM `shop`.`orders` AS o WHERE o.`customer_id` = ?", "mysql", "shop.orders:o"],
    ["SELECT * FROM [dbo].[orders] o WITH (NOLOCK) WHERE o.[customer_id] = @p1", "mssql", "dbo.orders:o"],
    ['SELECT * FROM "orders" WHERE "customer_id" = ?', "sqlite", ".orders:"],
    ["SELECT * FROM [orders] WHERE [customer_id] = ?", "sqlite", ".orders:"],
    ["SELECT * FROM mydb.dbo.orders AS o WHERE o.customer_id = :id", "oracle", "dbo.orders:o"],
  ];
  for (const [sql, engine, expected] of cases) {
    const [block] = readStatement(sql, engine);
    assert.ok(block, sql);
    const [ref] = block.tables;
    assert.equal(`${ref.schema ?? ""}.${ref.name}:${ref.alias ?? ""}`, expected, sql);
    assert.deepEqual(
      block.uses.map((u) => u.column),
      ["customer_id"],
      sql,
    );
  }
});

test("equality columns come before the range, which comes before the sort", () => {
  const sql = "SELECT * FROM orders WHERE created_at > ? AND status = ? AND customer_id = ? ORDER BY total";
  assert.deepEqual(columnsOf([stat(sql)], [orders()], "postgres"), ["orders(status,customer_id,created_at)"]);
  // Without a range, the sort follows the equality columns.
  assert.deepEqual(
    columnsOf(
      [stat("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, total")],
      [orders()],
      "postgres",
    ),
    ["orders(customer_id,created_at,total)"],
  );
  // A sort alone is worth an index only with a limit.
  assert.deepEqual(columnsOf([stat("SELECT * FROM orders ORDER BY created_at")], [orders()], "postgres"), []);
  assert.deepEqual(columnsOf([stat("SELECT * FROM orders ORDER BY created_at LIMIT ?")], [orders()], "postgres"), [
    "orders(created_at)",
  ]);
  assert.deepEqual(columnsOf([stat("SELECT TOP (?) * FROM [orders] ORDER BY [created_at]")], [orders()], "mssql"), [
    "orders(created_at)",
  ]);
});

test("IN, BETWEEN and IS NULL count; OR, LIKE, functions and negations do not", () => {
  const read = (where: string) => columnsOf([stat(`SELECT * FROM orders WHERE ${where}`)], [orders()], "postgres");
  assert.deepEqual(read("status IN (?) AND total BETWEEN ? AND ?"), ["orders(status,total)"]);
  assert.deepEqual(read("customer_id IS NULL"), ["orders(customer_id)"]);
  assert.deepEqual(read("status = ? OR customer_id = ?"), []);
  assert.deepEqual(read("status LIKE ?"), []);
  assert.deepEqual(read("lower(status) = ?"), []);
  assert.deepEqual(read("status <> ? AND customer_id NOT IN (?)"), []);
  assert.deepEqual(read("(status = ? AND (customer_id = ?))"), ["orders(status,customer_id)"]);
});

test("joins: both sides, by alias, through unqualified columns resolved in the catalog", () => {
  const catalog = [orders(), customers];
  const sql =
    "SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.country = ? AND o.status = ? ORDER BY o.created_at";
  // `c.id` is the primary key, joined on: one customer per order, so a filter on its country needs no index.
  assert.deepEqual(columnsOf([stat(sql)], catalog, "postgres"), ["orders(customer_id,status,created_at)"]);
  assert.deepEqual(columnsOf([stat("SELECT * FROM customers c WHERE c.country = ?")], catalog, "postgres"), [
    "customers(country)",
  ]);
  // Unqualified names resolve to the one table that has them.
  assert.deepEqual(
    columnsOf(
      [stat("SELECT * FROM orders JOIN customers ON customers.id = customer_id WHERE country = ?")],
      catalog,
      "mysql",
    ),
    ["orders(customer_id)"],
  );
  // Same column name on both tables, unqualified: ambiguous, so left alone.
  assert.deepEqual(columnsOf([stat("SELECT * FROM orders, customers WHERE id = ?")], catalog, "postgres"), []);
  const plain = (name: string): Catalog[number] => ({
    schema: null,
    name,
    columns: ["id", "k", "x"],
    indexes: [{ columns: ["id"], unique: true }],
  });
  assert.deepEqual(
    columnsOf(
      [stat("SELECT * FROM a INNER JOIN b USING (k) WHERE a.x = ?")],
      [plain("a"), plain("b")],
      "postgres",
    ).sort(),
    ["a(k,x)", "b(k)"],
  );
  // Joined on both tables' keys: one row each, nothing an index would help.
  assert.deepEqual(
    columnsOf([stat("SELECT * FROM a INNER JOIN b USING (id) WHERE a.x = ?")], [plain("a"), plain("b")], "postgres"),
    [],
  );
  // A subquery is read as a block of its own.
  assert.deepEqual(
    columnsOf(
      [stat("SELECT * FROM customers WHERE id IN (SELECT customer_id FROM orders WHERE status = ?)")],
      catalog,
      "postgres",
    ),
    ["orders(status)"],
  );
});

test("UPDATE and DELETE are read like a SELECT", () => {
  assert.deepEqual(columnsOf([stat("UPDATE orders SET total = ? WHERE status = ?")], [orders()], "postgres"), [
    "orders(status)",
  ]);
  assert.deepEqual(columnsOf([stat("DELETE FROM orders WHERE customer_id = ?")], [orders()], "sqlite"), [
    "orders(customer_id)",
  ]);
});

test("an index that already covers the columns hides the suggestion; a multi-column one covers its leading columns", () => {
  const sql = "SELECT * FROM orders WHERE customer_id = ? AND status = ?";
  assert.deepEqual(columnsOf([stat(sql)], [orders()], "postgres"), ["orders(customer_id,status)"]);
  assert.deepEqual(columnsOf([stat(sql)], [orders([["status", "customer_id", "total"]])], "postgres"), []);
  assert.deepEqual(columnsOf([stat(sql)], [orders([["customer_id", "status"]])], "postgres"), []);
  // The leading column alone does not cover two equality columns.
  assert.deepEqual(columnsOf([stat(sql)], [orders([["customer_id", "total", "status"]])], "postgres"), [
    "orders(customer_id,status)",
  ]);
  // One column is covered by the beginning of a longer index.
  assert.deepEqual(
    columnsOf([stat("SELECT * FROM orders WHERE customer_id = ?")], [orders([["customer_id", "status"]])], "postgres"),
    [],
  );
  assert.deepEqual(columnsOf([stat("SELECT * FROM orders WHERE id = ?")], [orders()], "postgres"), []);
});

test("statements that cannot be read, tables without statements and failed statements give nothing", () => {
  for (const sql of [
    "EXPLAIN ANALYZE SELECT 1",
    "SELECT * FROM orders WHERE (((",
    "SELECT * FROM 'orders' WHERE",
    "CREATE TABLE orders (customer_id int)",
    "SELECT * FROM generate_series(1, ?) g WHERE g = ?",
    "SELECT `unterminated FROM orders WHERE x = ?",
    "",
  ]) {
    assert.deepEqual(columnsOf([stat(sql)], [orders()], "postgres"), [], sql);
  }
  const sql = "SELECT * FROM orders WHERE status = ?";
  assert.deepEqual(columnsOf([stat(sql)], [], "postgres"), []);
  assert.deepEqual(columnsOf([stat(sql)], [customers], "postgres"), []);
  assert.deepEqual(columnsOf([stat(sql, 3, 30, 3)], [orders()], "postgres"), []);
  assert.deepEqual(columnsOf([stat("SELECT * FROM orders WHERE nope = ?")], [orders()], "postgres"), []);
  assert.deepEqual(columnsOf([stat(sql)], [orders()], "bigquery"), []);
});

test("suggestions are measured, merged, ordered by time and capped; the CREATE INDEX is the engine's", () => {
  const a = stat("SELECT * FROM orders WHERE customer_id = ?", 100, 3000);
  const b = stat("SELECT * FROM orders WHERE customer_id = ? AND status = ?", 5, 1000);
  const c = stat("SELECT * FROM customers WHERE country = ?", 2, 6000);
  const other = stat("SELECT 1", 1, 0);
  const [first, second, ...rest] = suggestIndexes([a, b, c, other], [orders(), customers], "postgres");
  assert.equal(rest.length, 0);
  // (customer_id) is the beginning of (customer_id, status): one suggestion, both statements.
  assert.equal(first.table, "customers");
  assert.deepEqual(second.columns, ["customer_id", "status"]);
  assert.equal(second.statementCount, 2);
  assert.equal(second.executions, 105);
  assert.equal(second.totalMs, 4000);
  assert.equal(second.shareOfMeasuredMs, 40);
  assert.deepEqual(
    second.statements.map((s) => s.sql),
    [a.sql, b.sql],
  );
  assert.equal(
    second.createStatement,
    'CREATE INDEX IF NOT EXISTS "idx_orders_customer_id_status" ON "public"."orders" ("customer_id", "status");',
  );
  assert.equal(
    suggestIndexes([a], [{ ...orders(), schema: null }], "mssql")[0].createStatement,
    "CREATE INDEX [idx_orders_customer_id] ON [orders] ([customer_id]);",
  );
  assert.equal(
    suggestIndexes([a], [{ ...orders(), schema: null }], "mysql")[0].createStatement,
    "CREATE INDEX IF NOT EXISTS `idx_orders_customer_id` ON `orders` (`customer_id`);",
  );

  const many = Array.from({ length: 15 }, (_, i) => stat(`SELECT * FROM orders WHERE col${i} = ?`, 1, 100 + i));
  const table = { ...orders(), columns: ["id", ...many.map((_, i) => `col${i}`)] };
  const capped = suggestIndexes(many, [table], "postgres");
  assert.equal(capped.length, 10);
  assert.equal(capped[0].columns[0], "col14");
});

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

async function login(app: App, admin: boolean) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), email, await hashPassword(password), admin ? 1 : 0, admin ? "Ada Admin" : "Bob");
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

test("index-suggestions route: from the recorded statements and the live indexes, administrators only", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, true);
    const member = await login(app, false);
    const conn = (
      await call(app, admin, "POST", "/api/admin/connections", {
        name: "Local",
        engine: "sqlite",
        filePath: join(mkdtempSync(join(tmpdir(), "nebuladb-suggest-")), "shop.sqlite"),
      })
    ).json().connection.id as string;
    const url = `/api/admin/connections/${conn}/index-suggestions`;
    const run = (sql: string, readOnly = true) =>
      call(app, admin, "POST", `/api/admin/connections/${conn}/query`, { sql, readOnly });

    assert.equal(
      (await run("CREATE TABLE items (id INTEGER PRIMARY KEY, owner INTEGER, label TEXT)", false)).statusCode,
      200,
    );
    assert.equal((await run("CREATE TABLE ghosts (id INTEGER PRIMARY KEY, owner INTEGER)", false)).statusCode, 200);
    assert.equal((await run("CREATE INDEX idx_items_label ON items (label)", false)).statusCode, 200);
    for (const owner of [1, 2, 3]) {
      assert.equal((await run(`SELECT * FROM items WHERE owner = ${owner}`)).statusCode, 200);
    }
    for (const id of [1, 2]) assert.equal((await run(`SELECT * FROM items WHERE id = ${id}`)).statusCode, 200);
    assert.equal((await run("SELECT * FROM items WHERE label = 'x'")).statusCode, 200);

    const res = await call(app, admin, "GET", url);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as {
      suggestions: {
        table: string;
        columns: string[];
        executions: number;
        createStatement: string;
        statements: { sql: string }[];
      }[];
      projects: unknown[];
    };
    // The unindexed column only: the key and the existing index are there, `ghosts` was never queried.
    assert.equal(body.suggestions.length, 1, res.body);
    const [suggestion] = body.suggestions;
    assert.equal(suggestion.table, "items");
    assert.deepEqual(suggestion.columns, ["owner"]);
    assert.equal(suggestion.executions, 3);
    assert.deepEqual(
      suggestion.statements.map((s) => s.sql),
      ["SELECT * FROM items WHERE owner = ?"],
    );
    assert.equal(suggestion.createStatement, 'CREATE INDEX IF NOT EXISTS "idx_items_owner" ON "items" ("owner");');
    assert.deepEqual(body.projects, []);

    assert.equal((await call(app, admin, "GET", `${url}?days=abc`)).json().code, "ACTIVITY_QUERY_INVALID");
    assert.equal((await call(app, admin, "GET", `/api/admin/connections/nope/index-suggestions`)).statusCode, 404);
    assert.equal((await call(app, member, "GET", url)).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url, headers: { host: HOST, origin: ORIGIN } })).statusCode, 401);
  } finally {
    await app.close();
  }
});
