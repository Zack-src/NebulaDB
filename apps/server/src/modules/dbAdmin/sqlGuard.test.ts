import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`. Without
// this, importing it would open — and migrate — the developer's real `./data` database.
process.env.NEBULADB_DB_PATH ??= join(tmpdir(), `nebuladb-test-sqlguard-${randomUUID()}.sqlite`);

const { assertDataStatement, assertReadOnlyStatement, findStructuralStatements, isRowReturningQuery, stripSqlNoise } =
  await import("./sqlGuard.js");
const { accountInConnectionString } = await import("./connectionAccount.js");

test("a member's write may only be one data statement — never structure, accounts or the server", () => {
  const engines = ["postgres", "mysql", "mssql", "oracle", "sqlite"] as const;
  for (const engine of engines) {
    for (const sql of [
      "INSERT INTO customers (name) VALUES ('a')",
      "UPDATE customers SET name = 'drop table x' WHERE id = 1",
      "DELETE FROM customers WHERE id = 1;",
      "SELECT * FROM customers",
    ]) {
      assert.doesNotThrow(() => assertDataStatement(sql, engine), `${engine}: ${sql}`);
    }
    for (const sql of [
      "CREATE TABLE t (id int)",
      "DROP TABLE customers",
      "ALTER TABLE customers ADD x int",
      "TRUNCATE TABLE customers",
      "DELETE FROM a; DROP TABLE b",
      "UPDATE a SET x = 1 CREATE TABLE b (id int)",
      "GRANT SELECT ON a TO bob",
      "CALL wipe()",
      "EXEC sp_who",
      "SELECT * INTO copy FROM customers",
      "INSERT INTO a SELECT * INTO b FROM c",
      "DELETE FROM customers WHERE id IN (SELECT 1) INTO OUTFILE '/tmp/x'",
      "COMMIT",
      "",
    ]) {
      assert.throws(
        () => assertDataStatement(sql, engine),
        (err: { code?: string }) =>
          err.code === "DB_ACCESS_STATEMENT_NOT_ALLOWED" || err.code === "DB_ADMIN_WRITE_NOT_ALLOWED",
        `${engine}: ${sql}`,
      );
    }
  }
  // An upsert is a data statement.
  assert.doesNotThrow(() =>
    assertDataStatement("INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 2", "postgres"),
  );
  assert.doesNotThrow(() => assertDataStatement("REPLACE INTO t (id) VALUES (1)", "mysql"));
  assert.throws(() => assertDataStatement("INSERT INTO t VALUES (1) /*! ; DROP TABLE t */", "mysql"));
  assert.throws(() => assertDataStatement("ATTACH DATABASE 'x' AS y", "sqlite"));
});

test("the account a connection signs in with is read from its fields or its connection string", () => {
  assert.equal(accountInConnectionString("postgres://deployer:secret@db:5432/shop"), "deployer");
  assert.equal(accountInConnectionString("mysql://app%40corp:x@db/shop"), "app@corp");
  assert.equal(accountInConnectionString("Server=db;Database=shop;User Id=sa_app;Password=x"), "sa_app");
  assert.equal(accountInConnectionString("Server=db;UID=svc;PWD=x"), "svc");
  assert.equal(accountInConnectionString(undefined), null);
  assert.equal(accountInConnectionString("db.example.com:1521/ORCL"), null);
});

const rejects = (sql: string, engine: Parameters<typeof assertReadOnlyStatement>[1]) =>
  assert.throws(() => assertReadOnlyStatement(sql, engine), { code: "DB_ADMIN_WRITE_NOT_ALLOWED" }, sql);
const accepts = (sql: string, engine: Parameters<typeof assertReadOnlyStatement>[1]) =>
  assert.doesNotThrow(() => assertReadOnlyStatement(sql, engine), sql);

test("read-only guard accepts plain reads on every engine", () => {
  for (const engine of ["postgres", "mysql", "mssql", "oracle", "sqlite"] as const) {
    accepts("SELECT * FROM users WHERE name = 'drop; delete'", engine);
    accepts("  -- a comment\n WITH x AS (SELECT 1) SELECT * FROM x;", engine);
    accepts("(SELECT 1) UNION (SELECT 2)", engine);
  }
  accepts("SHOW TABLES", "mysql");
  accepts("EXPLAIN SELECT 1", "postgres");
  accepts("PRAGMA table_info(users)", "sqlite");
});

test("read-only guard rejects writes, DDL and anything that is not one statement", () => {
  rejects("DELETE FROM users", "postgres");
  rejects("drop table users", "mysql");
  rejects("SELECT 1; DROP TABLE users", "postgres");
  rejects("COMMIT", "postgres");
  rejects("", "postgres");
  rejects("PRAGMA journal_mode = WAL", "postgres");
});

test("read-only guard rejects SELECT ... INTO and MySQL executable comments", () => {
  rejects("SELECT * INTO copy FROM users", "mssql");
  rejects("SELECT * FROM users INTO OUTFILE '/tmp/x'", "mysql");
  rejects("SELECT 1 /*! INTO OUTFILE '/tmp/x' */", "mysql");
});

test("SQL Server: a write keyword anywhere in the batch is rejected, since no separator is needed", () => {
  rejects("SELECT 1 DROP TABLE users", "mssql");
  rejects("SELECT 1 EXEC xp_cmdshell 'dir'", "mssql");
  accepts("SELECT [update], [delete] FROM [drop]", "mssql");
  accepts("SELECT 'insert into x' AS txt", "mssql");
});

test("stripSqlNoise blanks literals, comments and quoted identifiers", () => {
  assert.ok(!stripSqlNoise("SELECT 'a;b' /* ; */ -- ;\n", "postgres").includes(";"));
  assert.ok(!stripSqlNoise("SELECT $fn$ ; drop $fn$", "postgres").includes(";"));
  assert.ok(!stripSqlNoise("SELECT 'it\\'s; fine' # ;", "mysql").includes(";"));
});

test("isRowReturningQuery tells cursor-readable statements apart", () => {
  assert.equal(isRowReturningQuery("select 1", "postgres"), true);
  assert.equal(isRowReturningQuery("SHOW work_mem", "postgres"), false);
  assert.equal(isRowReturningQuery("EXPLAIN SELECT 1", "postgres"), false);
});

const structural = (sql: string, engine: Parameters<typeof findStructuralStatements>[1] = "postgres") =>
  findStructuralStatements(sql, engine).map((a) => `${a.verb} ${a.kind} ${a.object ?? "?"}`);

test("structural statements: table and index DDL is found, with the object when it can be read", () => {
  assert.deepEqual(structural("DROP TABLE orders"), ["drop table orders"]);
  assert.deepEqual(structural("drop table if exists public.orders cascade;"), ["drop table public.orders"]);
  assert.deepEqual(structural("ALTER TABLE ONLY users ADD COLUMN phone text"), ["alter table users"]);
  assert.deepEqual(structural("CREATE TABLE IF NOT EXISTS audit (id int)"), ["create table audit"]);
  assert.deepEqual(structural("CREATE UNLOGGED TABLE fast (id int)"), ["create table fast"]);
  assert.deepEqual(structural("CREATE UNIQUE INDEX CONCURRENTLY idx_u ON users (email)"), ["create index idx_u"]);
  assert.deepEqual(structural("CREATE TABLE copy AS SELECT * FROM users"), ["create table copy"]);
  assert.deepEqual(structural("RENAME TABLE a TO b", "mysql"), ["rename table a"]);
  // A quoted name is blanked before the check: reported, without a name.
  assert.deepEqual(structural('DROP TABLE "Order Items"'), ["drop table ?"]);
  // Several statements, one of them data.
  assert.deepEqual(structural("INSERT INTO t VALUES (1); DROP INDEX idx_a; -- bye\n ALTER TABLE t DROP COLUMN c"), [
    "drop index idx_a",
    "alter table t",
  ]);
});

test("structural statements: data, permissions, temporary tables and unmodelled objects are left alone", () => {
  for (const sql of [
    "SELECT * FROM users",
    "UPDATE users SET name = 'DROP TABLE users'",
    "DELETE FROM orders -- then ALTER TABLE orders",
    "TRUNCATE TABLE orders",
    "INSERT INTO log (msg) VALUES ('create table x')",
    "CREATE VIEW v AS SELECT 1",
    "DROP VIEW v",
    "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE t; END $$ LANGUAGE plpgsql",
    "CREATE TEMP TABLE scratch (id int)",
    "CREATE TEMPORARY TABLE scratch AS SELECT 1",
    "COMMENT ON TABLE users IS 'x'",
    "DROP DATABASE shop",
  ]) {
    assert.deepEqual(structural(sql), [], sql);
  }
  assert.deepEqual(structural("GRANT CREATE TABLE TO app", "mssql"), []);
  assert.deepEqual(structural("GRANT ALTER ON TABLE users TO app"), []);
  assert.deepEqual(structural("CREATE TABLE #scratch (id int)", "mssql"), []);
  // Oracle's GLOBAL TEMPORARY table is a permanent definition.
  assert.deepEqual(structural("CREATE GLOBAL TEMPORARY TABLE gtt (id number)", "oracle"), ["create table gtt"]);
});

test("structural statements: a SQL Server batch needs no separator between statements", () => {
  assert.deepEqual(structural("SELECT 1\nDROP TABLE dbo.orders\nALTER TABLE [dbo].[users] ADD phone int", "mssql"), [
    "drop table dbo.orders",
    "alter table ?",
  ]);
  // Elsewhere the first keyword decides, so a column called `drop_table` cannot trip it.
  assert.deepEqual(structural("SELECT 1\nDROP TABLE orders", "postgres"), []);
});
