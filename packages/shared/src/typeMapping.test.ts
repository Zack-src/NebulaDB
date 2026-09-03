import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_ENGINES, translateType } from "./typeMapping.js";

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

test("SUPPORTED_ENGINES lists all five engines", () => {
  assert.deepEqual([...SUPPORTED_ENGINES].sort(), ["mssql", "mysql", "oracle", "postgres", "sqlite"]);
});
