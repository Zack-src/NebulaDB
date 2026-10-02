import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`. Without
// this, importing it would open — and migrate — the developer's real `./data` database.
process.env.ATHANORDB_DB_PATH ??= join(tmpdir(), `athanordb-test-sqlguard-${randomUUID()}.sqlite`);

const { assertReadOnlyStatement, isRowReturningQuery, stripSqlNoise } = await import("./sqlGuard.js");

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
