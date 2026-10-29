import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`, and
// importing that connects: it needs a database to connect to, even with nothing to store.
await useTestDatabase("sqlguardch");

const { assertReadOnlyStatement } = await import("./sqlGuard.js");

const accepts = (sql: string) => assert.doesNotThrow(() => assertReadOnlyStatement(sql, "clickhouse"), sql);
const refuses = (sql: string) =>
  assert.throws(() => assertReadOnlyStatement(sql, "clickhouse"), { code: "DB_ADMIN_WRITE_NOT_ALLOWED" }, sql);

test("ClickHouse: a read-only statement is a SELECT or a WITH, and nothing else", () => {
  for (const sql of [
    "SELECT 1",
    "select count() from `shop`.`orders`",
    "WITH t AS (SELECT 1 AS a) SELECT a FROM t",
    "SELECT 'DROP TABLE x' AS text",
    "SELECT * FROM orders WHERE note = 'a; b'",
  ]) {
    accepts(sql);
  }
  for (const sql of [
    "DROP TABLE orders",
    "INSERT INTO orders VALUES (1)",
    "ALTER TABLE orders DELETE WHERE 1",
    "TRUNCATE TABLE orders",
    "SYSTEM SHUTDOWN",
    "OPTIMIZE TABLE orders",
    "SET readonly = 0",
    "KILL QUERY WHERE 1",
    "SELECT 1; DROP TABLE orders",
    "SELECT * FROM orders INTO OUTFILE '/tmp/orders.csv'",
    "",
  ]) {
    refuses(sql);
  }
});

test("ClickHouse: a table function that reaches a file, another host or a program is refused", () => {
  for (const sql of [
    "SELECT * FROM url('http://169.254.169.254/', 'CSV', 'a String')",
    "SELECT * FROM file('/etc/passwd', 'CSV', 'a String')",
    "SELECT * FROM remote('other-host', db.orders)",
    "SELECT * FROM remoteSecure('other-host', db.orders)",
    "SELECT * FROM s3('https://bucket/x.csv', 'CSV', 'a String')",
    "SELECT * FROM executable('ls', TSV, 'a String')",
    "SELECT * FROM mysql('host:3306', 'db', 'table', 'user', 'pw')",
    "SELECT * FROM  URL  ('http://x', CSV, 'a String')",
  ]) {
    refuses(sql);
  }
});

test("ClickHouse: a column or a word that only looks like a table function is not one", () => {
  for (const sql of [
    "SELECT url, file FROM pages WHERE url = 'http://example.com'",
    "SELECT 'url(' AS text",
    "SELECT file, input FROM uploads",
    "SELECT * FROM `url`",
  ]) {
    accepts(sql);
  }
});

test("ClickHouse: a quote is closed by a doubled quote or escaped, and a # starts a comment", () => {
  accepts("SELECT 'it''s; DROP TABLE t' AS a");
  accepts("SELECT 'a\\'; DROP TABLE t' AS a");
  accepts("SELECT 1 # ; DROP TABLE t");
  accepts("SELECT 1 -- ; DROP TABLE t");
  refuses("SELECT 1 -- note\n; DROP TABLE t");
});
