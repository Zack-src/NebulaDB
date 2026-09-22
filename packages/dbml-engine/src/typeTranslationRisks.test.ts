import test from "node:test";
import assert from "node:assert/strict";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { detectTypeTranslationRisks } from "./typeTranslationRisks.js";
import type { Project } from "@athanordb/shared";

function makeProject(tables: { name: string; fields: { name: string; type: string; pk?: boolean }[] }[]): Project {
  return {
    id: "p1",
    name: "Test",
    tables: tables.map((t) => ({
      id: t.name,
      name: t.name,
      fields: t.fields.map((f) => ({ id: `${t.name}.${f.name}`, name: f.name, type: f.type, pk: f.pk })),
      indexes: [],
      position: { x: 0, y: 0 },
      detailLevel: "standard" as const,
    })),
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
}

test("flags a new table's non-native type when deploying to a different engine", () => {
  const live = makeProject([]);
  const target = makeProject([{ name: "users", fields: [{ name: "id", type: "uuid", pk: true }] }]);
  const diff = diffTargetAgainstLive(live, target);

  const risks = detectTypeTranslationRisks(diff, "mssql");
  assert.equal(risks.length, 1);
  assert.equal(risks[0].type, "TYPE_TRANSLATION_SUGGESTED");
  assert.equal(risks[0].tableName, "users");
  assert.equal(risks[0].columnName, "id");
  assert.equal(risks[0].suggestedValue, "uniqueidentifier");
  assert.equal(risks[0].defaultStrategy, "USE_TRANSLATED_TYPE");
});

test("no risk when the written type is already native for the target engine", () => {
  const live = makeProject([]);
  const target = makeProject([{ name: "users", fields: [{ name: "id", type: "uuid", pk: true }] }]);
  const diff = diffTargetAgainstLive(live, target);

  assert.deepEqual(detectTypeTranslationRisks(diff, "postgres"), []);
});

test("ignores unchanged fields on a modified table, and dropped tables entirely", () => {
  const live = makeProject([
    { name: "users", fields: [{ name: "id", type: "uuid", pk: true }, { name: "notes", type: "text" }] },
    { name: "legacy", fields: [{ name: "id", type: "uuid", pk: true }] },
  ]);
  const target = makeProject([
    { name: "users", fields: [{ name: "id", type: "uuid", pk: true }, { name: "notes", type: "text" }, { name: "extra", type: "json" }] },
  ]);
  const diff = diffTargetAgainstLive(live, target);

  const risks = detectTypeTranslationRisks(diff, "mssql");
  // "id"/"notes" are unchanged -> not in the diff's field list, so no risk even though
  // uuid/text aren't mssql-native; only the newly added "extra" column is flagged.
  assert.equal(risks.length, 1);
  assert.equal(risks[0].columnName, "extra");
  assert.equal(risks[0].suggestedValue, "nvarchar(max)");
});
