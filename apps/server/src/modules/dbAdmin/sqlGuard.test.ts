import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`, and
// importing that connects: it needs a database to connect to, even with nothing to store.
await useTestDatabase("sqlguard");

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

// ---- Bypass attempts: the guard must lex each dialect as the server does ------

const rejectsData = (sql: string, engine: Parameters<typeof assertDataStatement>[1]) =>
  assert.throws(
    () => assertDataStatement(sql, engine),
    (err: { code?: string }) =>
      err.code === "DB_ACCESS_STATEMENT_NOT_ALLOWED" || err.code === "DB_ADMIN_WRITE_NOT_ALLOWED",
    `${engine}: ${sql}`,
  );
const acceptsData = (sql: string, engine: Parameters<typeof assertDataStatement>[1]) =>
  assert.doesNotThrow(() => assertDataStatement(sql, engine), `${engine}: ${sql}`);

test("BigQuery: `#` is a comment, so it cannot open a fake string over a second statement", () => {
  rejects("SELECT 1 # '\n; DELETE FROM ds.t WHERE TRUE; # '", "bigquery");
  rejects("SELECT 1 # x\nDELETE FROM ds.t WHERE TRUE", "bigquery");
  accepts("SELECT 1 # ; DELETE FROM ds.t\n", "bigquery");
  accepts("SELECT 1 -- ;\n/* ; */", "bigquery");
});

test("BigQuery: triple quotes, backslash escapes and backticks are read as GoogleSQL reads them", () => {
  accepts("SELECT '''a ' ; DELETE FROM t WHERE TRUE; ''' AS s", "bigquery");
  accepts('SELECT """ " ; DROP TABLE t; """ AS s', "bigquery");
  accepts("SELECT 'a\\'; DELETE FROM t WHERE TRUE; --' AS s", "bigquery");
  accepts("SELECT r'\\'; DELETE FROM t WHERE TRUE; --' AS s", "bigquery");
  accepts("SELECT `update`, `delete` FROM `proj.ds.t`", "bigquery");
  // `''` is an empty string, not an escaped quote: what follows is code.
  rejects("SELECT '' ; DELETE FROM t WHERE TRUE", "bigquery");
  rejects("SELECT 'a''' ; DELETE FROM t WHERE TRUE; '''", "bigquery");
  // `'a'` then a triple-quoted string: no second statement.
  accepts("SELECT 'a'''' ; DELETE FROM t WHERE TRUE; ''' AS s", "bigquery");
});

test("BigQuery: read-only is a whitelist", () => {
  accepts(
    "WITH x AS (SELECT a, b FROM `p.d.t` WHERE TRUE) SELECT ARRAY_AGG(a IGNORE NULLS LIMIT 3) FROM x " +
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY a ORDER BY b DESC) = 1",
    "bigquery",
  );
  accepts("SELECT * FROM UNNEST([1, 2]) AS n CROSS JOIN t FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP()", "bigquery");
  for (const sql of [
    "INSERT INTO d.t VALUES (1)",
    "DELETE FROM d.t WHERE TRUE",
    "MERGE d.t USING d.s ON TRUE WHEN MATCHED THEN DELETE",
    "CREATE TABLE d.t AS SELECT 1",
    "EXPORT DATA OPTIONS (uri = 'gs://b/*') AS SELECT 1",
    "SELECT 1 SET x = 1",
    "SELECT * FROM d.t INTO x",
    "BEGIN SELECT 1; END",
    "DECLARE x INT64 DEFAULT 1",
    "EXECUTE IMMEDIATE 'DELETE FROM d.t WHERE TRUE'",
    "CALL d.proc()",
    "SHOW TABLES",
    "VALUES (1)",
  ]) {
    rejects(sql, "bigquery");
  }
});

test("SQL Server: read-only is a whitelist of reserved words, so statements without a separator are caught", () => {
  for (const sql of [
    "SELECT 1 DISABLE TRIGGER trg_audit ON dbo.t",
    "SELECT 1 ENABLE TRIGGER trg_audit ON dbo.t",
    "SELECT 1 DECLARE @p varbinary(16) SELECT @p=TEXTPTR(c) FROM t WRITETEXT t.c @p 'x'",
    "SELECT 1 UPDATETEXT t.c @p 0 NULL 'x'",
    "SELECT 1 RECEIVE TOP(1) * FROM dbo.q",
    "SELECT 1 SEND ON CONVERSATION @h ('x')",
    "SELECT 1 END CONVERSATION @h",
    "SELECT 1 SETUSER 'dbo'",
    "SELECT 1 CHECKPOINT",
    "SELECT 1 IF 1 = 1 PRINT 'x'",
    "SELECT 1 SET NOCOUNT ON",
    "SELECT 1 BEGIN TRAN",
    "SELECT 1 GOTO done",
    "SELECT 1 OPEN c",
    "SELECT 1 REVERT",
    "SELECT 1 TRUNCATE TABLE t",
    "SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1')",
    "SELECT 1 WAITFOR DELAY '00:01'",
    "WITH x AS (SELECT 1 AS a) UPDATE x SET a = 2",
    "WITH x AS (SELECT 1 AS a) DELETE FROM x",
    "SHOW TABLES",
    "VALUES (1)",
    "EXPLAIN SELECT 1",
  ]) {
    rejects(sql, "mssql");
  }
  for (const sql of [
    "SELECT TOP 10 PERCENT a FROM t WITH (NOLOCK) ORDER BY a",
    "SELECT a FROM t ORDER BY a OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY",
    "SELECT CASE WHEN a IS NOT NULL THEN 1 ELSE 0 END, CONVERT(int, b), COALESCE(c, 0), NULLIF(d, 0) " +
      "FROM t LEFT OUTER JOIN u ON t.id = u.id WHERE d LIKE 'x%' AND e BETWEEN 1 AND 2 GROUP BY a HAVING COUNT(*) > 1",
    "SELECT * FROM t FOR JSON PATH",
    "SELECT CAST(1 AS DOUBLE PRECISION), CURRENT_TIMESTAMP, SYSTEM_USER, USER",
    "SELECT @@ROWCOUNT, @@VERSION",
    "SELECT * FROM #scratch",
    "SELECT a FROM t UNION ALL SELECT a FROM u EXCEPT SELECT a FROM v",
    "SELECT * FROM t CROSS APPLY OPENJSON(t.j)",
    'SELECT "update" FROM "drop"',
    "SELECT ROW_NUMBER() OVER (PARTITION BY a ORDER BY b) FROM t",
  ]) {
    accepts(sql, "mssql");
  }
});

test("SQL Server: `]]` escapes inside brackets, and block comments nest", () => {
  accepts("SELECT [a]]; DROP TABLE x --] FROM t", "mssql");
  rejects("SELECT [a]]] DROP TABLE x", "mssql");
  accepts("SELECT 1 /* /* */ DROP TABLE t */", "mssql");
  rejects("SELECT 1 /* /* */ */ DROP TABLE t", "mssql");
  // `#` is a temporary table, not a comment.
  rejects("SELECT 1 FROM #t\nDROP TABLE x", "mssql");
});

test("SQL Server: a member's write is held to a whitelist too", () => {
  for (const sql of [
    "UPDATE t SET a = 1 WHERE id = 1",
    "INSERT INTO t (a) OUTPUT inserted.id VALUES (1)",
    "INSERT INTO t DEFAULT VALUES",
    "DELETE TOP (10) FROM t WHERE a IS NULL",
    "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a WHEN NOT MATCHED THEN INSERT (id) VALUES (s.id);",
  ]) {
    acceptsData(sql, "mssql");
  }
  for (const sql of [
    "UPDATE t SET a = 1 DISABLE TRIGGER audit ON t",
    "UPDATE t SET a = 1 ENABLE TRIGGER audit ON t",
    "UPDATE t SET a = 1 SET IDENTITY_INSERT t ON",
    "UPDATE t SET a = 1 DECLARE @x int",
    "UPDATE t SET a = 1 WRITETEXT t.c @p 'x'",
    "UPDATE t SET a = 1 RECEIVE * FROM q",
    "UPDATE t SET a = 1 IF 1 = 1 PRINT 'x'",
    "UPDATE t SET a = 1 SETUSER",
    "DELETE FROM t CHECKPOINT",
  ]) {
    rejectsData(sql, "mssql");
  }
});

test("PostgreSQL: E'' strings and dollar quotes glued to an identifier cannot hide a second statement", () => {
  rejectsData("UPDATE t SET a = E'\\'' ; DROP TABLE users; GRANT ALL ON ALL TABLES IN SCHEMA public TO public; --'", "postgres");
  rejectsData("UPDATE t SET a = e'\\'' ; DROP TABLE users; --'", "postgres");
  rejectsData("UPDATE t SET a = (SELECT 1 AS q$z$) ; DROP TABLE users; -- $z$", "postgres");
  rejects("SELECT E'\\'' ; DELETE FROM t; --'", "postgres");
  rejects("SELECT 1 AS q$z$ ; DELETE FROM t; -- $z$", "postgres");
  rejects("SELECT 1 AS q$z$ FROM t$tag$ ; DELETE FROM t; $tag$", "postgres");
  // After a number or a parameter, a dollar quote does open.
  rejects("SELECT 1$z$ ' $z$; DELETE FROM t; --'", "postgres");
  rejects("SELECT $1$z$ ' $z$; DELETE FROM t; --'", "postgres");
  rejects("SELECT 0x1F$z$ ' $z$; DELETE FROM t; --'", "postgres");
  // Real dollar quotes and escape strings are still blanked.
  accepts("SELECT $$ ; DELETE FROM t $$, $tag_1$ ; $tag_1$, E'it\\'s ; fine', U&'d\\0061t' FROM t", "postgres");
  acceptsData("UPDATE t SET a = E'it\\'s ; DROP TABLE x', b = $$ ; $$", "postgres");
});

test("PostgreSQL: a backslash in a plain string is checked both with and without standard_conforming_strings", () => {
  // On: one string. Off: `\'` escapes, the next quote closes, and a DELETE follows.
  rejects("SELECT 'a\\'' ; DELETE FROM t; --'", "postgres");
  accepts("SELECT 'C:\\temp\\', 'x' FROM t", "postgres");
});

test("PostgreSQL: block comments nest", () => {
  accepts("SELECT 1 /* /* */ ; DELETE FROM t; /* */ */", "postgres");
  rejects("SELECT 1 /* /* */ */ ; DELETE FROM t", "postgres");
  // Oracle's do not.
  rejects("SELECT 1 FROM dual /* /* */ ; DELETE FROM t; /* */ */", "oracle");
});

test("MySQL: `--` needs a blank, backticks have no escape, settings that change quoting are covered", () => {
  rejects("SELECT 1 --1 INTO OUTFILE '/var/lib/mysql-files/x'", "mysql");
  rejects("SELECT 1 AS `x\\` INTO DUMPFILE '/tmp/p' -- `", "mysql");
  rejects("SELECT 1 --;\nDELETE FROM t", "mysql");
  accepts("SELECT 1 -- ;\n", "mysql");
  accepts("SELECT 1 --\t;\n", "mysql");
  // NO_BACKSLASH_ESCAPES: `\'` does not escape.
  rejects("SELECT 'a\\' ; DELETE FROM t; -- '", "mysql");
  // ANSI_QUOTES: `"…"` is an identifier, with no escape.
  rejects('SELECT "a\\" ; DELETE FROM t; -- "', "mysql");
  accepts("SELECT 'it''s; fine', `a``;b` FROM t", "mysql");
  // OUTFILE / DUMPFILE are refused as words, MariaDB's executable comments too.
  rejects("SELECT 1 FROM t /*M! INTO OUTFILE '/tmp/x' */", "mysql");
  rejects("SELECT 1 FROM t /*M!100000 ; DROP TABLE t */", "mysql");
  rejectsData("UPDATE t SET a = 1 --1 ;\nDROP TABLE t", "mysql");
});

test("Oracle: alternative quoting q'[…]'", () => {
  rejects("SELECT q'[ ' ]' FROM dual; DELETE FROM t", "oracle");
  accepts("SELECT q'[ ; DELETE FROM t ]', Q'{ ' }', nq'< ; >', q'! ; !' FROM dual", "oracle");
  // `xq` is an identifier: what follows is a plain string.
  accepts("SELECT xq'[ ; ]' FROM dual", "oracle");
});

test("SQLite: brackets and backticks quote identifiers", () => {
  rejects("SELECT [a'] ; DELETE FROM t; --'", "sqlite");
  rejects("SELECT `a'` ; DELETE FROM t; --'", "sqlite");
  accepts("SELECT [a;b], `c;d`, \"e;f\" FROM t", "sqlite");
});

test("every engine: a write hidden behind each kind of noise is still seen", () => {
  const engines = ["postgres", "mysql", "mssql", "oracle", "sqlite", "bigquery"] as const;
  const hiders = ["-- x\n", "/* x */", "'a'", '"a"', "/**/", "-- '\n", "/* ' */", "-- \"\n"];
  for (const engine of engines) {
    for (const hider of hiders) {
      rejects(`SELECT 1 ${hider} ; DELETE FROM t`, engine);
      rejects(`SELECT 1 ${hider}; DELETE FROM t ${hider}`, engine);
      rejectsData(`UPDATE t SET a = 1 ${hider} ; DROP TABLE t`, engine);
    }
  }
});
