import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_ENGINES, neutralType, translateType } from "./typeMapping.js";

test("translateType passes through unrecognized types unchanged", () => {
  const result = translateType("my_custom_domain", "mssql");
  assert.equal(result.changed, false);
  assert.equal(result.type, "my_custom_domain");
});

test("translateType: a spelling already valid on the target engine is left untouched, even if another spelling is more idiomatic", () => {
  // "int" is perfectly valid Postgres syntax (alias for "integer") — not a compatibility
  // problem, so it's not rewritten just because "integer" is the more common spelling.
  assert.deepEqual(translateType("int", "postgres"), { original: "int", type: "int", changed: false });
  // Same story for varchar on SQL Server: it's valid there, unlike types SQL Server has
  // no equivalent for at all (uuid, boolean, json — see below).
  assert.deepEqual(translateType("varchar(255)", "mssql"), {
    original: "varchar(255)",
    type: "varchar(255)",
    changed: false,
  });
});

test("translateType: boolean has no native type on mysql/mssql/oracle", () => {
  assert.equal(translateType("boolean", "postgres").changed, false);
  assert.equal(translateType("boolean", "sqlite").changed, false);
  assert.equal(translateType("boolean", "mysql").type, "tinyint(1)");
  assert.equal(translateType("boolean", "mssql").type, "bit");
  assert.equal(translateType("boolean", "oracle").type, "number(1)");
});

test("translateType: uuid has no native type outside postgres/mssql", () => {
  assert.equal(translateType("uuid", "postgres").changed, false);
  assert.equal(translateType("uuid", "mysql").type, "char(36)");
  assert.equal(translateType("uuid", "mssql").type, "uniqueidentifier");
  assert.equal(translateType("uuid", "oracle").type, "raw(16)");
  assert.equal(translateType("uuid", "sqlite").type, "text");
});

test("translateType: json/jsonb has no native type outside postgres/mysql", () => {
  assert.equal(translateType("json", "postgres").changed, false);
  assert.equal(translateType("jsonb", "mysql").type, "json"); // mysql knows json, not jsonb specifically
  assert.equal(translateType("json", "mssql").type, "nvarchar(max)");
  assert.equal(translateType("json", "oracle").type, "clob");
  assert.equal(translateType("json", "sqlite").type, "text");
});

test("translateType: decimal(p,s) is valid everywhere but Oracle, which spells it number(p,s)", () => {
  assert.equal(translateType("decimal(10,2)", "postgres").changed, false);
  assert.equal(translateType("numeric(10,2)", "mysql").changed, false);
  assert.equal(translateType("decimal(10,2)", "oracle").type, "number(10,2)");
});

test("translateType: varchar without a length falls back to a default when it has to be translated", () => {
  assert.equal(translateType("varchar", "oracle").type, "varchar2(255)");
});

test("translateType: text has no native type on mssql/oracle", () => {
  assert.equal(translateType("text", "postgres").changed, false);
  assert.equal(translateType("text", "mssql").type, "nvarchar(max)");
  assert.equal(translateType("text", "oracle").type, "clob");
});

test("translateType: timestamp has no native type on mssql", () => {
  assert.equal(translateType("timestamp", "mysql").changed, false); // mysql does have TIMESTAMP
  assert.equal(translateType("timestamp", "mssql").type, "datetime2");
});

test("translateType: int is a valid spelling on every engine but Oracle", () => {
  assert.equal(translateType("int", "postgres").changed, false);
  assert.equal(translateType("integer", "mysql").changed, false);
  assert.equal(translateType("int", "sqlite").changed, false);
  assert.equal(translateType("int", "oracle").type, "number(10)");
});

test("SUPPORTED_ENGINES lists every engine", () => {
  assert.deepEqual([...SUPPORTED_ENGINES].sort(), ["bigquery", "mssql", "mysql", "oracle", "postgres", "sqlite"]);
});

test("translateType: BigQuery has its own names for text, booleans, floats, dates and bytes", () => {
  assert.equal(translateType("varchar(255)", "bigquery").type, "STRING(255)");
  assert.equal(translateType("varchar", "bigquery").type, "STRING");
  assert.equal(translateType("char(2)", "bigquery").type, "STRING(2)");
  assert.equal(translateType("text", "bigquery").type, "STRING");
  assert.equal(translateType("uuid", "bigquery").type, "STRING");
  assert.equal(translateType("bit", "bigquery").type, "BOOL");
  assert.equal(translateType("float", "bigquery").type, "FLOAT64");
  assert.equal(translateType("double precision", "bigquery").type, "FLOAT64");
  assert.equal(translateType("datetime2", "bigquery").type, "DATETIME");
  assert.equal(translateType("timestamptz", "bigquery").type, "TIMESTAMP");
  assert.equal(translateType("varbinary(16)", "bigquery").type, "BYTES");
  assert.equal(translateType("jsonb", "bigquery").type, "JSON");
  assert.equal(translateType("int4", "bigquery").type, "INT64");
});

test("translateType: what BigQuery already reads is left as written", () => {
  for (const type of [
    "int",
    "bigint",
    "smallint",
    "decimal(18,6)",
    "numeric(10,2)",
    "boolean",
    "date",
    "time",
    "datetime",
    "timestamp",
    "json",
    "string",
    "int64",
    "float64",
    "bytes",
  ]) {
    assert.deepEqual(translateType(type, "bigquery"), { original: type, type, changed: false }, type);
  }
});

test("translateType: a decimal too wide for BigQuery's NUMERIC becomes BIGNUMERIC", () => {
  assert.equal(translateType("decimal(38,9)", "bigquery").changed, false);
  assert.equal(translateType("decimal(40,2)", "bigquery").type, "BIGNUMERIC(40,2)");
  assert.equal(translateType("numeric(20,12)", "bigquery").type, "BIGNUMERIC(20,12)");
});

test("translateType: SQL Server's (max) is the long text or binary type everywhere else", () => {
  assert.equal(translateType("varchar(max)", "mssql").changed, false);
  assert.equal(translateType("nvarchar(max)", "mssql").changed, false);
  assert.equal(translateType("varchar(max)", "postgres").type, "text");
  assert.equal(translateType("nvarchar(max)", "mysql").type, "longtext");
  assert.equal(translateType("varchar(max)", "oracle").type, "clob");
  assert.equal(translateType("varchar(max)", "sqlite").type, "text");
  assert.equal(translateType("varchar(max)", "bigquery").type, "STRING");
  assert.equal(translateType("varbinary(max)", "postgres").type, "bytea");
  assert.equal(translateType("varbinary(max)", "mysql").type, "longblob");
  assert.equal(translateType("varbinary(max)", "bigquery").type, "BYTES");
});

test("translateType: bit is a boolean — kept where the word exists, translated where it does not", () => {
  for (const engine of ["mssql", "mysql", "postgres", "sqlite"] as const) {
    assert.equal(translateType("bit", engine).changed, false, engine);
  }
  assert.equal(translateType("bit", "oracle").type, "number(1)");
});

test("translateType: a type BigQuery writes its own way goes back to the other engines", () => {
  assert.equal(translateType("int64", "postgres").type, "bigint");
  assert.equal(translateType("float64", "mssql").type, "float");
  assert.equal(translateType("bytes", "postgres").type, "bytea");
  assert.equal(translateType("string", "mssql").type, "nvarchar(max)");
});

test("neutralType: the same column on two engines is the same type", () => {
  assert.equal(neutralType("varchar(255)"), neutralType("STRING(255)"));
  assert.equal(neutralType("varchar(max)"), neutralType("STRING"));
  assert.equal(neutralType("int"), neutralType("INT64"));
  assert.equal(neutralType("bit"), neutralType("BOOL"));
  assert.equal(neutralType("decimal(18,6)"), neutralType("NUMERIC(18, 6)"));
  assert.equal(neutralType("datetime2"), neutralType("DATETIME"));
  assert.equal(neutralType("double precision"), neutralType("FLOAT64"));
  // What is really different stays different.
  assert.notEqual(neutralType("varchar(255)"), neutralType("STRING(100)"));
  assert.notEqual(neutralType("decimal(18,6)"), neutralType("NUMERIC(18,2)"));
  assert.notEqual(neutralType("int"), neutralType("varchar(10)"));
  assert.equal(neutralType("My_Domain"), "my_domain");
});
