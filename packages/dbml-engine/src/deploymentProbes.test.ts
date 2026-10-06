import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Table } from "@nebuladb/shared";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { declaredLength, planRiskProbes, riskFromProbe } from "./deploymentProbes.js";

function table(id: string, name: string, fields: Partial<Field>[], extra: Partial<Table> = {}): Table {
  return {
    id,
    name,
    fields: fields.map((field, i) => ({ id: `${id}.${field.name ?? i}`, name: "", type: "int", ...field }) as Field),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
    ...extra,
  };
}

function project(tables: Table[], refs: Project["refs"] = []): Project {
  return { id: "p", name: "P", tables, refs, enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

const live = project([
  table("users", "users", [
    { name: "id", type: "int", pk: true },
    { name: "email", type: "varchar(320)" },
    { name: "bio", type: "text" },
    { name: "nickname", type: "varchar(40)" },
    { name: "legacy", type: "int" },
  ]),
  table("orders", "orders", [
    { name: "id", type: "int", pk: true },
    { name: "user_id", type: "int" },
  ]),
  table("old_logs", "old_logs", [{ name: "id", type: "int", pk: true }]),
]);

const target = project(
  [
    table("users", "users", [
      { name: "id", type: "int", pk: true },
      { name: "email", type: "varchar(255)", unique: true },
      { name: "bio", type: "varchar(500)" },
      { name: "nickname", type: "varchar(40)", notNull: true },
      { name: "country", type: "char(2)", notNull: true },
    ]),
    table("orders", "orders", [
      { name: "id", type: "int", pk: true },
      { name: "user_id", type: "int" },
    ]),
    table("fresh", "fresh", [{ name: "id", type: "int", pk: true }]),
  ],
  [
    {
      id: "r1",
      from: { tableId: "orders", fieldId: "orders.user_id" },
      to: { tableId: "users", fieldId: "users.id" },
      cardinality: "one-to-many",
    },
  ],
);

test("every destructive change of a plan gets one aggregate probe", () => {
  const probes = planRiskProbes(diffTargetAgainstLive(live, target), "postgres");
  const summary = probes.map((p) => `${p.type} ${p.tableName}${p.columnName ? `.${p.columnName}` : ""}`).sort();
  assert.deepEqual(summary, [
    "ADD_NOT_NULL_NO_DEFAULT users.country",
    "DROP_COLUMN_WITH_DATA users.legacy",
    "DROP_TABLE_WITH_DATA old_logs",
    "FK_VIOLATION orders.user_id",
    "LENGTH_REDUCTION users.email",
    "NULL_TO_NOT_NULL users.nickname",
    "UNIQUE_VIOLATION users.email",
  ]);
  for (const probe of probes) {
    assert.match(probe.sql, /^SELECT (COUNT\(\*\)|MAX\()/, "aggregates only — never row data");
    assert.doesNotMatch(probe.sql, /SELECT \*/);
  }
});

test("probe SQL is written for the target's dialect", () => {
  const diff = diffTargetAgainstLive(live, target);
  const length = (dialect: "mssql" | "mysql" | "oracle") =>
    planRiskProbes(diff, dialect).find((p) => p.type === "LENGTH_REDUCTION" && p.columnName === "email")!.sql;
  assert.equal(length("mssql"), "SELECT MAX(LEN([email])) FROM [users]");
  assert.equal(length("mysql"), "SELECT MAX(CHAR_LENGTH(`email`)) FROM `users`");
  assert.equal(length("oracle"), 'SELECT MAX(LENGTH("email")) FROM "users"');
  assert.equal(
    planRiskProbes(diff, "postgres").find((p) => p.type === "FK_VIOLATION")!.sql,
    'SELECT COUNT(*) FROM "orders" f WHERE f."user_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" t WHERE t."id" = f."user_id")',
  );
  assert.equal(
    planRiskProbes(diff, "sqlite").filter((p) => p.type === "FK_VIOLATION").length,
    0,
    "SQLite cannot add a foreign key to an existing table, so nothing to probe",
  );
});

test("a number becomes a risk only when it means one", () => {
  const probes = planRiskProbes(diffTargetAgainstLive(live, target), "postgres");
  const probe = (type: string, column?: string) =>
    probes.find((p) => p.type === type && (column === undefined || p.columnName === column))!;

  assert.equal(riskFromProbe(probe("DROP_TABLE_WITH_DATA"), 0), null, "an empty table drops safely");
  const drop = riskFromProbe(probe("DROP_TABLE_WITH_DATA"), 12)!;
  assert.equal(drop.severity, "critical");
  assert.equal(drop.affectedRowCount, 12);
  assert.equal(drop.defaultStrategy, "KEEP_IN_DB");
  assert.equal(drop.resolutionKey, "table:old_logs");

  const fits = riskFromProbe(probe("LENGTH_REDUCTION", "email"), 187)!;
  assert.equal(fits.severity, "info");
  assert.deepEqual([fits.measuredMax, fits.limit], [187, 255]);
  const overflow = riskFromProbe(probe("LENGTH_REDUCTION", "email"), 300)!;
  assert.equal(overflow.severity, "critical");
  assert.equal(overflow.defaultStrategy, "CANCEL");

  const duplicates = riskFromProbe(probe("UNIQUE_VIOLATION"), 3)!;
  assert.deepEqual(
    duplicates.availableStrategies.map((s) => s.key),
    ["CANCEL"],
    "the database would refuse the constraint: only fixing the data helps",
  );

  const unknown = riskFromProbe(probe("DROP_COLUMN_WITH_DATA"), null)!;
  assert.equal(unknown.unmeasured, true);
  assert.equal(unknown.severity, "warning");
});

test("a size change is a type change; text to a bounded varchar is not flagged (introspection spells them loosely)", () => {
  const diff = diffTargetAgainstLive(live, target);
  const users = diff.tables.find((t) => t.name === "users")!;
  assert.equal(users.fields.find((f) => f.name === "email")?.typeChanged, true);
  assert.equal(users.fields.find((f) => f.name === "bio")?.typeChanged, undefined);
});

test("declaredLength reads the usual spellings", () => {
  assert.equal(declaredLength("varchar(255)"), 255);
  assert.equal(declaredLength("character varying(80)"), 80);
  assert.equal(declaredLength("NVARCHAR(40)"), 40);
  assert.equal(declaredLength("varchar2(30 char)"), 30);
  assert.equal(declaredLength("char(2)"), 2);
  assert.equal(declaredLength("text"), null);
  assert.equal(declaredLength("int"), null);
});
