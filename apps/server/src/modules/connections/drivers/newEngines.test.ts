import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../../infrastructure/testDatabase.js";

// The drivers reach `infrastructure/db.ts` through `shared/errors.ts`, and importing that connects:
// it needs a database to connect to, even with nothing to store.
await useTestDatabase("newengines");

const { clickhouseFieldType, clickhouseStatements } = await import("./clickhouse.js");
const { serverVersion } = await import("./redis.js");
const { tokenize } = await import("../../dbAdmin/drivers/redis.js");

test("ClickHouse: a nullable type is read as its type, not null being the exception", () => {
  assert.deepEqual(clickhouseFieldType("Int32"), { type: "Int32", notNull: true });
  assert.deepEqual(clickhouseFieldType("Nullable(String)"), { type: "String", notNull: false });
  assert.deepEqual(clickhouseFieldType("LowCardinality(Nullable(String))"), { type: "String", notNull: false });
  assert.deepEqual(clickhouseFieldType("LowCardinality(String)"), { type: "String", notNull: true });
  assert.deepEqual(clickhouseFieldType("Decimal(18, 6)"), { type: "Decimal(18, 6)", notNull: true });
  assert.deepEqual(clickhouseFieldType("Array(Nullable(Int8))"), { type: "Array(Nullable(Int8))", notNull: true });
});

test("ClickHouse: a script is split into statements, the comments that stand alone left out", () => {
  const script = [
    "CREATE TABLE `a` (\n  `id` Int32\n)\nENGINE = MergeTree\nORDER BY (`id`);",
    "-- ClickHouse has no secondary indexes: `idx` on `a` is not created",
    "ALTER TABLE `a` ADD COLUMN `n` Nullable(String);",
    "-- a last remark",
  ].join("\n\n");
  const statements = clickhouseStatements(script);
  assert.equal(statements.length, 2);
  assert.match(statements[0]!, /^CREATE TABLE `a`/);
  assert.match(statements[1]!, /ADD COLUMN `n`/);
  assert.deepEqual(clickhouseStatements("-- No schema differences detected\n"), []);
});

test("Redis: a command line is split into words, a quoted word keeping its blanks", () => {
  assert.deepEqual(tokenize("GET user:1"), ["GET", "user:1"]);
  assert.deepEqual(tokenize(`HSET "user 1" name 'Ada Lovelace'`), ["HSET", "user 1", "name", "Ada Lovelace"]);
  assert.deepEqual(tokenize(`SET k "say \\"hi\\""`), ["SET", "k", `say "hi"`]);
  assert.deepEqual(tokenize("   "), []);
});

test("Redis and Valkey both say what they are in INFO", () => {
  assert.equal(serverVersion("# Server\r\nredis_version:7.2.13\r\nos:Linux\r\n"), "Redis 7.2.13");
  assert.equal(serverVersion("# Server\r\nredis_version:7.2.4\r\nvalkey_version:8.0.1\r\n"), "Valkey 8.0.1");
});
