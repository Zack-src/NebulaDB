import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Ref, Table } from "@nebuladb/shared";
import { planCleanDeployment } from "./cleanDeployment.js";

function table(name: string, fields: Partial<Field>[]): Table {
  return {
    id: name,
    name,
    fields: fields.map((field) => ({ id: `${name}.${field.name}`, type: "int", ...field }) as Field),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

const project = (tables: Table[], refs: Ref[] = []): Project => ({
  id: "p",
  name: "P",
  tables,
  refs,
  enums: [],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
});

const ref = (from: string, to: string, name?: string): Ref =>
  ({
    id: `${from}-${to}`,
    ...(name ? { name } : {}),
    from: { tableId: from, fieldId: `${from}.${to}_id` },
    to: { tableId: to, fieldId: `${to}.id` },
    cardinality: "one-to-many",
  }) as Ref;

// What the database holds: a key inside the primary key, a foreign key, and a table nobody told Nebula about.
const live = project(
  [
    table("analyse", [{ name: "id", pk: true }]),
    table("results", [{ name: "id_analyse", pk: true }, { name: "analyse_id" }]),
    table("made_by_hand", [{ name: "id", pk: true }]),
  ],
  [ref("results", "analyse", "fk_results_analyse")],
);

test("a wipe drops the keys, then the tables, and creates nothing", () => {
  for (const dialect of ["bigquery", "postgres", "mysql", "mssql"] as const) {
    const plan = planCleanDeployment(live, dialect, new Set(["analyse", "results"]));
    const sql = plan.sql;
    const dropKey = sql.search(/DROP (CONSTRAINT|FOREIGN KEY)/);
    const dropTable = sql.search(/DROP TABLE/);
    assert.ok(dropKey >= 0 && dropKey < dropTable, `${dialect}: the foreign key goes before the tables`);
    assert.doesNotMatch(sql, /CREATE/, `${dialect}: nothing is created again`);
    assert.doesNotMatch(sql, /made_by_hand/, `${dialect}: a table out of scope is left alone`);
    assert.doesNotMatch(sql, /DROP COLUMN|RENAME/, `${dialect}: no column-level step to get stuck on`);
    assert.deepEqual(plan.dropTables, ["analyse", "results"]);
    assert.equal((sql.match(/DROP TABLE/g) ?? []).length, 2);
  }
});

test("the transaction wrapper appears once, and not for BigQuery", () => {
  const scope = new Set(["analyse", "results"]);
  const pg = planCleanDeployment(live, "postgres", scope).sql;
  assert.equal((pg.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((pg.match(/^COMMIT;$/gm) ?? []).length, 1);
  const bq = planCleanDeployment(live, "bigquery", scope).sql;
  assert.doesNotMatch(bq, /BEGIN|COMMIT/);
});

test("with every table in scope, the table nobody told Nebula about goes too", () => {
  const scope = new Set(live.tables.map((t) => t.name.toLowerCase()));
  const plan = planCleanDeployment(live, "postgres", scope);
  assert.deepEqual(plan.dropTables, ["analyse", "results", "made_by_hand"]);
  assert.match(plan.sql, /DROP TABLE IF EXISTS "made_by_hand"/);
});

test("a foreign key from a table that stays to one that goes is dropped first", () => {
  const outside = project(
    [table("analyse", [{ name: "id", pk: true }]), table("keeps", [{ name: "id", pk: true }, { name: "analyse_id" }])],
    [ref("keeps", "analyse", "fk_keeps_analyse")],
  );
  const plan = planCleanDeployment(outside, "mysql", new Set(["analyse"]));
  assert.match(plan.sql, /ALTER TABLE `keeps` DROP FOREIGN KEY `fk_keeps_analyse`/);
  assert.ok(plan.sql.search(/DROP FOREIGN KEY/) < plan.sql.search(/DROP TABLE/));
});
