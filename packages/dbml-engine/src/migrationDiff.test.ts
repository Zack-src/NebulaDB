import test from "node:test";
import assert from "node:assert/strict";
import type { Project, Ref } from "@athanordb/shared";
import { diffTargetAgainstLive } from "./migrationDiff.js";

interface ShorthandField {
  id?: string;
  name: string;
  type?: string;
  pk?: boolean;
  notNull?: boolean;
  default?: string;
  unique?: boolean;
}

interface ShorthandTable {
  id?: string;
  name: string;
  fields?: ShorthandField[];
  indexes?: Project["tables"][number]["indexes"];
}

interface ShorthandRef {
  id?: string;
  name?: string;
  from: Ref["from"];
  to: Ref["to"];
}

function makeProject(name: string, tables: ShorthandTable[] = [], refs: ShorthandRef[] = []): Project {
  return {
    id: "p1",
    name,
    tables: tables.map((t) => ({
      id: t.id || t.name,
      name: t.name,
      fields: (t.fields || []).map((f) => ({
        id: f.id || `${t.name}.${f.name}`,
        name: f.name,
        type: f.type || "text",
        pk: f.pk,
        notNull: f.notNull,
        default: f.default,
        unique: f.unique,
      })),
      indexes: t.indexes || [],
      position: { x: 0, y: 0 },
      detailLevel: "standard" as const,
    })),
    refs: refs.map((r, i) => ({
      id: r.id || `ref-${i}`,
      name: r.name,
      from: r.from,
      to: r.to,
      cardinality: "one-to-many" as const,
    })),
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
}

test("diffTargetAgainstLive detects added and dropped tables", () => {
  const live = makeProject("Live", [{ name: "old_table", fields: [{ name: "id", type: "int" }] }]);
  const target = makeProject("Target", [{ name: "new_table", fields: [{ name: "id", type: "int" }] }]);

  const diff = diffTargetAgainstLive(live, target);

  assert.equal(diff.hasChanges, true);
  assert.equal(diff.tables.length, 2);

  const dropped = diff.tables.find((t) => t.name === "old_table");
  const added = diff.tables.find((t) => t.name === "new_table");

  assert.equal(dropped?.status, "dropped");
  assert.equal(added?.status, "added");
});

test("diffTargetAgainstLive detects added, dropped, and modified columns", () => {
  const live = makeProject("Live", [
    {
      name: "users",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "legacy_col", type: "text" },
        { name: "age", type: "int" },
        { name: "email", type: "varchar", notNull: false },
      ],
    },
  ]);

  const target = makeProject("Target", [
    {
      name: "users",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "age", type: "text" }, // type changed int -> text
        { name: "email", type: "varchar", notNull: true }, // nullability changed
        { name: "new_avatar", type: "text" }, // added
      ],
    },
  ]);

  const diff = diffTargetAgainstLive(live, target);

  assert.equal(diff.hasChanges, true);
  const users = diff.tables.find((t) => t.name === "users");
  assert.ok(users);
  assert.equal(users.status, "modified");

  const droppedCol = users.fields.find((f) => f.name === "legacy_col");
  assert.equal(droppedCol?.status, "dropped");

  const addedCol = users.fields.find((f) => f.name === "new_avatar");
  assert.equal(addedCol?.status, "added");

  const ageCol = users.fields.find((f) => f.name === "age");
  assert.equal(ageCol?.status, "modified");
  assert.equal(ageCol?.typeChanged, true);

  const emailCol = users.fields.find((f) => f.name === "email");
  assert.equal(emailCol?.status, "modified");
  assert.equal(emailCol?.notNullChanged, true);
});

test("diffTargetAgainstLive ignores identical schema regardless of table casing or UUIDs", () => {
  const live = makeProject("Live", [
    { id: "uuid-1", name: "Users", fields: [{ id: "u-f1", name: "id", type: "integer", pk: true }] },
  ]);
  const target = makeProject("Target", [
    { id: "uuid-2", name: "users", fields: [{ id: "u-f2", name: "id", type: "int", pk: true }] },
  ]);

  const diff = diffTargetAgainstLive(live, target);
  assert.equal(diff.hasChanges, false);
});
