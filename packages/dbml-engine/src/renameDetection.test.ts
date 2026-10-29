import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Table } from "@nebuladb/shared";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { generateMigrationSql } from "./migrationGenerator.js";
import { generateRollbackSql } from "./rollbackGenerator.js";
import { chosenRenames, detectRenameCandidates, renameResolutionKey, supersededByRename } from "./renameDetection.js";
import { riskFromProbe, planRiskProbes } from "./deploymentProbes.js";

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

const project = (tables: Table[]): Project => ({
  id: "p",
  name: "P",
  tables,
  refs: [],
  enums: [],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
});

test("a column that vanishes while a near-identical one appears is a rename suggestion", () => {
  const live = project([
    table("analyse_list", [
      { name: "id", pk: true },
      { name: "id_analyse", notNull: true },
      { name: "creation_date", type: "timestamp" },
      { name: "legacy", type: "text" },
    ]),
  ]);
  const target = project([
    table("analyse_list", [
      { name: "id", pk: true },
      { name: "id_analyze", notNull: true },
      { name: "date_creation", type: "timestamp" },
      { name: "brand_new", type: "text" },
    ]),
  ]);
  const risks = detectRenameCandidates(diffTargetAgainstLive(live, target));
  assert.deepEqual(
    risks.map((risk) => `${risk.columnName}->${risk.detail}`).sort(),
    ["creation_date->date_creation", "id_analyse->id_analyze"],
    "`legacy` / `brand_new` share a type but not a name: not a rename",
  );
  assert.equal(risks[0]!.defaultStrategy, "RENAME_COLUMN");
  assert.deepEqual(
    risks[0]!.availableStrategies.map((option) => option.key),
    ["RENAME_COLUMN", "KEEP_SEPARATE"],
  );
});

test("a different type or nullability is not a rename", () => {
  const live = project([
    table("t", [
      { name: "id", pk: true },
      { name: "id_analyse", type: "int" },
    ]),
  ]);
  const retyped = project([
    table("t", [
      { name: "id", pk: true },
      { name: "id_analyze", type: "text" },
    ]),
  ]);
  assert.equal(detectRenameCandidates(diffTargetAgainstLive(live, retyped)).length, 0);
  const nullable = project([
    table("t", [
      { name: "id", pk: true },
      { name: "id_analyse", notNull: true },
    ]),
  ]);
  const loosened = project([table("t", [{ name: "id", pk: true }, { name: "id_analyze" }])]);
  assert.equal(detectRenameCandidates(diffTargetAgainstLive(nullable, loosened)).length, 0);
});

test("a rename becomes ALTER … RENAME COLUMN, with no drop and no add, and is undone by renaming back", () => {
  const live = project([table("t", [{ name: "id", pk: true }, { name: "id_analyse" }])]);
  const target = project([table("t", [{ name: "id", pk: true }, { name: "id_analyze" }])]);
  const diff = diffTargetAgainstLive(live, target);
  const key = renameResolutionKey("t", "id_analyse", "id_analyze");

  const renamed = generateMigrationSql(diff, "bigquery", { [key]: { strategy: "RENAME_COLUMN" } });
  assert.match(renamed, /ALTER TABLE `t` RENAME COLUMN `id_analyse` TO `id_analyze`;/);
  assert.doesNotMatch(renamed, /DROP COLUMN|ADD COLUMN/);
  assert.match(
    generateMigrationSql(diff, "mssql"),
    /EXEC sp_rename 't.id_analyse', 'id_analyze', 'COLUMN';/,
    "unanswered = rename",
  );
  assert.match(generateMigrationSql(diff, "postgres"), /RENAME COLUMN "id_analyse" TO "id_analyze"/);

  const separate = generateMigrationSql(diff, "bigquery", { [key]: { strategy: "KEEP_SEPARATE" } });
  assert.match(separate, /DROP COLUMN `id_analyse`/);
  assert.match(separate, /ADD COLUMN `id_analyze`/);
  assert.doesNotMatch(separate, /RENAME COLUMN/);

  const rollback = generateRollbackSql(diff, "postgres", { [key]: { strategy: "RENAME_COLUMN" } });
  assert.match(rollback.sql, /RENAME COLUMN "id_analyze" TO "id_analyse"/);
  assert.deepEqual(rollback.irreversible, [], "a renamed column lost nothing");
});

test("the drop a rename makes moot is not asked about", () => {
  const live = project([table("t", [{ name: "id", pk: true }, { name: "id_analyse" }])]);
  const target = project([table("t", [{ name: "id", pk: true }, { name: "id_analyze" }])]);
  const diff = diffTargetAgainstLive(live, target);
  const probes = planRiskProbes(diff, "postgres");
  const drop = riskFromProbe(
    probes.find((probe) => probe.type === "DROP_COLUMN_WITH_DATA")!,
    12,
  )!;
  const rename = detectRenameCandidates(diff)[0]!;
  assert.deepEqual([...supersededByRename([drop, rename], {})], [drop.id]);
  assert.equal(
    supersededByRename([drop, rename], { [rename.resolutionKey!]: { strategy: "KEEP_SEPARATE" } }).size,
    0,
    "kept separate: the drop is a real drop again",
  );
  assert.equal(chosenRenames(diff, {}).get("t")?.length, 1);
});
