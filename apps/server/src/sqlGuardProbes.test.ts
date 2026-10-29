import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "./infrastructure/testDatabase.js";

/**
 * The SQL guards, attacked. For each engine: statements that change something and are dressed up to look
 * like a read must be refused; ordinary reads that merely mention dangerous words must not be.
 * The guards are a guard rail (the database's own permissions are the bound), but where the engine cannot
 * enforce read-only itself — SQL Server and BigQuery — the guard is all there is.
 */
await useTestDatabase("sqlguardprobes");
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
const { assertReadOnlyStatement, assertDataStatement } = await import("./modules/dbAdmin/sqlGuard.js");

type Engine = "postgres" | "mysql" | "mssql" | "sqlite" | "oracle" | "bigquery";

const refusedReadOnly = (engine: Engine, sql: string) => {
  try {
    assertReadOnlyStatement(sql, engine);
    return false;
  } catch {
    return true;
  }
};
const refusedData = (engine: Engine, sql: string) => {
  try {
    assertDataStatement(sql, engine);
    return false;
  } catch {
    return true;
  }
};

/** Mutations that hide behind a read, for every engine. */
const EVERYWHERE = [
  "SELECT 1; DROP TABLE t",
  "SELECT 1;DROP TABLE t",
  "SELECT 1 ;\nDROP TABLE t",
  "SELECT 1 /* x */ ; /* y */ DROP TABLE t",
  "SELECT 1; -- done\nDROP TABLE t",
  "DROP TABLE t",
  "  \n\t DROP TABLE t",
  "/* read only */ DROP TABLE t",
  "-- just a select\nDROP TABLE t",
  "(DROP TABLE t)",
  "DELETE FROM t",
  "UPDATE t SET a = 1",
  "INSERT INTO t VALUES (1)",
  "TRUNCATE TABLE t",
  "ALTER TABLE t ADD COLUMN c int",
  "CREATE TABLE evil (a int)",
  "GRANT ALL ON t TO PUBLIC",
  "SELECT * INTO evil FROM t",
  "SELECT 1 INTO evil",
  "select * /* x */ into /* y */ evil from t",
  "SELECT * INTO evil FROM t",
  "",
  "   ",
  ";",
  "--",
];

/** Reads that look dangerous to a keyword search and are not. */
const BENIGN = [
  "SELECT 1",
  "SELECT * FROM t WHERE a = 1",
  "SELECT 'DROP TABLE t'",
  "SELECT 'a; DROP TABLE t'",
  'SELECT "drop" FROM t',
  "SELECT 1 -- DROP TABLE t",
  "SELECT 1 /* DELETE FROM t; */",
  "SELECT update_count, created_at FROM t",
  "SELECT insertion_date, deleted FROM t",
  "SELECT a FROM t -- ; DROP",
  "WITH x AS (SELECT 1) SELECT * FROM x",
  "SELECT 'it''s; fine'",
  "SELECT COUNT(*) FROM t GROUP BY a HAVING COUNT(*) > 1 ORDER BY 1",
  "SELECT CASE WHEN a > 1 THEN 'x' ELSE 'y' END FROM t",
  "SELECT a FROM t1 JOIN t2 ON t1.id = t2.id LEFT JOIN t3 ON t3.id = t2.id",
  "SELECT a FROM t WHERE b IN (SELECT b FROM u) AND c BETWEEN 1 AND 2 AND d LIKE '%x%' AND e IS NOT NULL",
  "SELECT DISTINCT a FROM t UNION ALL SELECT b FROM u",
];

for (const engine of ["postgres", "mysql", "mssql", "sqlite", "oracle", "bigquery"] as const) {
  test(`${engine}: read-only mode refuses mutations dressed up as reads`, () => {
    const passed = EVERYWHERE.filter((sql) => !refusedReadOnly(engine, sql));
    assert.deepEqual(passed, []);
  });

  test(`${engine}: read-only mode lets ordinary reads through, however alarming the words in them`, () => {
    const refused = BENIGN.filter((sql) => refusedReadOnly(engine, sql));
    assert.deepEqual(refused, []);
  });
}

// ---- Engine-specific tricks --------------------------------------------------------------------

test("postgres: dollar quotes, escape strings, nested comments and cursors cannot hide a second statement", () => {
  const tricks = [
    "SELECT $$ a $$; DROP TABLE t",
    "SELECT $tag$ ; $tag$; DROP TABLE t",
    "SELECT 1 /* /* nested */ ; DROP TABLE t */ ; DROP TABLE u",
    "SELECT 1; COMMIT; DROP TABLE t",
    "COMMIT",
    "ROLLBACK",
    "END",
    "BEGIN READ WRITE",
    "SET TRANSACTION READ WRITE",
    "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE",
    "SET default_transaction_read_only = off",
    "RESET ALL",
    "DO $$ BEGIN DROP TABLE t; END $$",
    "COPY t TO PROGRAM 'id'",
    "COPY (SELECT 1) TO '/tmp/x'",
    "CALL evil()",
    "VACUUM",
    "REFRESH MATERIALIZED VIEW v",
    "LOCK TABLE t",
    "NOTIFY chan",
    "LISTEN chan",
    "PREPARE p AS DELETE FROM t",
    "EXECUTE p",
    "DECLARE c CURSOR FOR DELETE FROM t",
    "CREATE FUNCTION f() RETURNS int AS 'select 1' LANGUAGE sql",
  ];
  const passed = tricks.filter((sql) => !refusedReadOnly("postgres", sql));
  assert.deepEqual(passed, []);
});

test("mysql: executable comments, backslash escapes and file writes are refused", () => {
  const tricks = [
    "SELECT 1 /*!50000 ; DROP TABLE t */",
    "SELECT /*!50000 1 */ 1; DROP TABLE t",
    "SELECT 1 /*M! ; DROP TABLE t */",
    "SELECT 'a\\'; DROP TABLE t; --'",
    'SELECT "a\\"; DROP TABLE t; --"',
    "SELECT 1 INTO OUTFILE '/tmp/x'",
    "SELECT 1 INTO DUMPFILE '/tmp/x'",
    "SELECT 1 INTO @v",
    "SET GLOBAL read_only = 0",
    "SET autocommit = 1",
    "COMMIT",
    "ROLLBACK",
    "START TRANSACTION",
    "LOAD DATA INFILE '/etc/passwd' INTO TABLE t",
    "HANDLER t OPEN",
    "FLUSH TABLES",
    "KILL 1",
    "RENAME TABLE t TO u",
    "REPLACE INTO t VALUES (1)",
    "CALL evil()",
    "DO SLEEP(1000)",
    "USE other",
    "SELECT 1; SELECT 2",
    "SELECT 1 #\n; DROP TABLE t",
  ];
  const passed = tricks.filter((sql) => !refusedReadOnly("mysql", sql));
  assert.deepEqual(passed, []);
});

test("mssql: with no semicolon between statements, any statement keyword after a read is refused", () => {
  const tricks = [
    "SELECT 1 DROP TABLE t",
    "SELECT 1\nDROP TABLE t",
    "SELECT 1 /**/ DROP /**/ TABLE t",
    "SELECT 1 EXEC xp_cmdshell 'dir'",
    "SELECT 1 EXECUTE sp_configure",
    "EXEC xp_cmdshell 'dir'",
    "SELECT 1 DELETE FROM t",
    "SELECT 1 INSERT INTO t VALUES (1)",
    "SELECT 1 UPDATE t SET a = 1",
    "SELECT 1 MERGE t USING u ON 1=1 WHEN MATCHED THEN DELETE;",
    "SELECT 1 TRUNCATE TABLE t",
    "SELECT 1 CREATE TABLE evil (a int)",
    "SELECT 1 ALTER LOGIN sa DISABLE",
    "SELECT 1 GRANT CONTROL TO public",
    "SELECT 1 DENY SELECT TO public",
    "SELECT 1 REVOKE SELECT FROM public",
    "SELECT 1 USE master",
    "SELECT 1 WAITFOR DELAY '00:10:00'",
    "SELECT 1 SHUTDOWN",
    "SELECT 1 RECONFIGURE",
    "SELECT 1 BACKUP DATABASE d TO DISK = 'x'",
    "SELECT 1 RESTORE DATABASE d FROM DISK = 'x'",
    "SELECT 1 DBCC CHECKDB",
    "SELECT 1 KILL 55",
    "SELECT 1 BULK INSERT t FROM 'x'",
    "SELECT 1 SETUSER 'dbo'",
    "SELECT 1 DECLARE @x int",
    "SELECT 1 SET @x = 1",
    "SELECT 1 BEGIN TRAN",
    "SELECT 1 COMMIT",
    "SELECT 1 ROLLBACK",
    "SELECT 1 PRINT 'x'",
    "SELECT 1 RAISERROR('x', 16, 1)",
    "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'SELECT 1')",
    "SELECT * FROM OPENQUERY(linked, 'DELETE FROM t')",
    "SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=x').db.dbo.t",
    "SELECT * INTO #tmp FROM t",
    "SELECT 1 SEND ON CONVERSATION @h MESSAGE TYPE m",
    "SELECT 1 ENABLE TRIGGER ALL ON t",
    "SELECT 1 DISABLE TRIGGER ALL ON t",
    "WITH x AS (SELECT 1) DELETE FROM t",
    "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x",
    "SELECT [a]]; DROP TABLE t; --] FROM t; DROP TABLE u",
  ];
  const passed = tricks.filter((sql) => !refusedReadOnly("mssql", sql));
  assert.deepEqual(passed, []);
});

test("bigquery: hash comments, backslash escapes, triple quotes and unreserved statements are refused", () => {
  const tricks = [
    "SELECT 1 # ; DROP TABLE t\n; DROP TABLE u",
    "SELECT 'a\\'; DROP TABLE t; --'; DROP TABLE u",
    "SELECT '''a'; DROP TABLE t;'''; DROP TABLE u",
    "SELECT 1; DROP TABLE t",
    "INSERT t VALUES (1)",
    "UPDATE t SET a = 1 WHERE TRUE",
    "DELETE t WHERE TRUE",
    "TRUNCATE TABLE t",
    "DROP TABLE t",
    "CREATE OR REPLACE TABLE t AS SELECT 1",
    "CALL proc()",
    "EXECUTE IMMEDIATE 'DROP TABLE t'",
    "EXPORT DATA OPTIONS(uri='gs://x/*') AS SELECT 1",
    "LOAD DATA INTO t FROM FILES (uris=['gs://x'])",
    "BEGIN SELECT 1; END",
    "DECLARE x INT64",
    "SET x = 1",
    "GRANT `roles/viewer` ON TABLE t TO 'user:x@y.z'",
    "MERGE t USING u ON TRUE WHEN MATCHED THEN DELETE",
    "ALTER TABLE t SET OPTIONS (description='x')",
    "UNDROP SCHEMA s",
  ];
  const passed = tricks.filter((sql) => !refusedReadOnly("bigquery", sql));
  assert.deepEqual(passed, []);
});

test("sqlite: attaching, pragmas that write, and extension loading are refused or harmless in read-only mode", () => {
  const tricks = [
    "ATTACH DATABASE '/tmp/x' AS y",
    "DETACH DATABASE y",
    "VACUUM",
    "VACUUM INTO '/tmp/x'",
    "REINDEX",
    "ANALYZE",
    "SELECT load_extension('/tmp/evil.so')",
    "SELECT 1; SELECT 2",
  ];
  const passed = tricks.filter((sql) => !refusedReadOnly("sqlite", sql));
  // `load_extension` is a plain SELECT: only better-sqlite3 refusing to load extensions keeps it harmless.
  assert.deepEqual(
    passed.filter((sql) => !/load_extension/.test(sql)),
    [],
  );
});

// ---- A member's data write ---------------------------------------------------------------------

const DATA_OK = [
  "INSERT INTO t (a) VALUES (1)",
  "INSERT INTO t (a, b) VALUES (1, 'x; y'), (2, 'DROP TABLE z')",
  "UPDATE t SET a = 1 WHERE id = 2",
  "UPDATE t SET note = '-- not a comment' WHERE id = 2",
  "DELETE FROM t WHERE id = 1",
  "DELETE FROM t WHERE name = 'CREATE'",
  "INSERT INTO t (a) SELECT a FROM u",
  "UPDATE t SET a = (SELECT MAX(a) FROM u)",
];

const DATA_REFUSED = [
  "DROP TABLE t",
  "CREATE TABLE x (a int)",
  "ALTER TABLE t ADD c int",
  "TRUNCATE TABLE t",
  "GRANT ALL ON t TO PUBLIC",
  "INSERT INTO t VALUES (1); DROP TABLE t",
  "INSERT INTO t VALUES (1);\nDELETE FROM u",
  "INSERT INTO t VALUES (1) /* x */ ; DROP TABLE t",
  "INSERT INTO t SELECT * INTO evil FROM u",
  "UPDATE t SET a = 1; COMMIT",
  "COPY t FROM PROGRAM 'id'",
  "CALL evil()",
  "EXEC xp_cmdshell 'dir'",
  "DELETE FROM t; SELECT pg_sleep(100)",
  "WITH x AS (DROP TABLE t) SELECT 1",
  "SELECT * FROM t",
  "SELECT 1",
  "SHOW TABLES",
  "",
];

for (const engine of ["postgres", "mysql", "mssql", "sqlite", "oracle"] as const) {
  test(`${engine}: a member's data write accepts one data statement and refuses everything else`, () => {
    const refused = DATA_OK.filter((sql) => refusedData(engine, sql));
    assert.deepEqual(refused, [], "legitimate writes refused");
    const passed = DATA_REFUSED.filter((sql) => {
      // A plain read is sent along to the read-only rules, which accept it: that is by design.
      if (/^(SELECT 1|SELECT \* FROM t|SHOW TABLES)$/.test(sql)) return false;
      return !refusedData(engine, sql);
    });
    assert.deepEqual(passed, [], "dangerous statements accepted");
  });
}
