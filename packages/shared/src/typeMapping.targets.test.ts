import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVERT_TARGETS, translateType } from "./typeMapping.js";

test("CONVERT_TARGETS lists the supported databases, then DuckDB", () => {
  assert.deepEqual(CONVERT_TARGETS, [
    "postgres",
    "mysql",
    "sqlite",
    "mssql",
    "oracle",
    "bigquery",
    "clickhouse",
    "mongodb",
    "redis",
    "duckdb",
  ]);
});

test("ClickHouse: sized strings, booleans and timestamps get ClickHouse spellings", () => {
  assert.deepEqual(translateType("varchar(255)", "clickhouse"), {
    original: "varchar(255)",
    type: "String",
    changed: true,
  });
  assert.equal(translateType("char(8)", "clickhouse").type, "FixedString(8)");
  assert.equal(translateType("boolean", "clickhouse").type, "Bool");
  assert.equal(translateType("timestamp", "clickhouse").type, "DateTime64(3)");
  assert.equal(translateType("decimal(10,2)", "clickhouse").type, "Decimal(10,2)");
  assert.equal(translateType("decimal", "clickhouse").type, "Decimal(38,9)");
});

test("ClickHouse: a type already spelled natively is left untouched", () => {
  assert.equal(translateType("uuid", "clickhouse").changed, false);
  assert.equal(translateType("date", "clickhouse").changed, false);
  assert.equal(translateType("string", "clickhouse").changed, false);
});

test("DuckDB: keeps the PostgreSQL-compatible spellings, translates SQL Server and Oracle ones", () => {
  assert.equal(translateType("int", "duckdb").changed, false);
  assert.equal(translateType("decimal(10,2)", "duckdb").changed, false);
  assert.equal(translateType("datetime2", "duckdb").type, "TIMESTAMP");
  assert.equal(translateType("nvarchar(max)", "duckdb").type, "VARCHAR");
  assert.equal(translateType("varbinary(max)", "duckdb").type, "BLOB");
});

test("MongoDB: types become BSON type names", () => {
  assert.equal(translateType("bigint", "mongodb").type, "long");
  assert.equal(translateType("varchar(255)", "mongodb").type, "string");
  assert.equal(translateType("datetime2", "mongodb").type, "date");
  assert.equal(translateType("uuid", "mongodb").type, "binData");
  assert.equal(translateType("jsonb", "mongodb").type, "object");
  assert.equal(translateType("bit", "mongodb").type, "bool");
});

test("MongoDB: BSON names already in place are left untouched", () => {
  assert.equal(translateType("string", "mongodb").changed, false);
  assert.equal(translateType("int", "mongodb").changed, false);
  assert.equal(translateType("double", "mongodb").changed, false);
});

test("Redis/Valkey: every recognized type becomes string, except string itself", () => {
  assert.equal(translateType("int", "redis").type, "string");
  assert.equal(translateType("varchar(255)", "redis").type, "string");
  assert.equal(translateType("jsonb", "redis").type, "string");
  assert.equal(translateType("string", "redis").changed, false);
});

test("unrecognized types still pass through for every new target", () => {
  for (const target of ["clickhouse", "duckdb", "mongodb", "redis"] as const) {
    assert.deepEqual(translateType("my_custom_domain", target), {
      original: "my_custom_domain",
      type: "my_custom_domain",
      changed: false,
    });
  }
});
