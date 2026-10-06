import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@nebuladb/shared";
import { diffProjects } from "./diff.js";

function baseProject(): Project {
  return {
    id: "p1",
    name: "Test",
    tables: [
      {
        id: "t-users",
        name: "users",
        fields: [
          { id: "f-id", name: "id", type: "int", pk: true },
          { id: "f-email", name: "email", type: "varchar" },
        ],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
      {
        id: "t-legacy",
        name: "legacy",
        fields: [{ id: "f-legacy-id", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
    ],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
}

test("no changes -> empty diff", () => {
  const p = baseProject();
  const diff = diffProjects(p, structuredClone(p));
  assert.deepEqual(diff.tables, []);
  assert.deepEqual(diff.refs, []);
});

test("added table", () => {
  const before = baseProject();
  const after = structuredClone(before);
  after.tables.push({
    id: "t-posts",
    name: "posts",
    fields: [{ id: "f-posts-id", name: "id", type: "int", pk: true }],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  });

  const diff = diffProjects(before, after);
  assert.equal(diff.tables.length, 1);
  assert.equal(diff.tables[0].id, "t-posts");
  assert.equal(diff.tables[0].status, "added");
});

test("removed table", () => {
  const before = baseProject();
  const after = structuredClone(before);
  after.tables = after.tables.filter((t) => t.id !== "t-legacy");

  const diff = diffProjects(before, after);
  assert.equal(diff.tables.length, 1);
  assert.equal(diff.tables[0].id, "t-legacy");
  assert.equal(diff.tables[0].status, "removed");
});

test("renamed table with no field changes is still reported, with renamedFrom set", () => {
  const before = baseProject();
  const after = structuredClone(before);
  after.tables[0].name = "accounts";

  const diff = diffProjects(before, after);
  const usersDiff = diff.tables.find((t) => t.id === "t-users")!;
  assert.equal(usersDiff.status, "changed");
  assert.equal(usersDiff.renamedFrom, "users");
  assert.equal(usersDiff.fields.length, 0);
});

test("field added/removed/changed within an unrenamed table", () => {
  const before = baseProject();
  const after = structuredClone(before);
  // remove email, add name, change id's type
  after.tables[0].fields = [
    { id: "f-id", name: "id", type: "bigint", pk: true },
    { id: "f-name", name: "name", type: "varchar" },
  ];

  const diff = diffProjects(before, after);
  const usersDiff = diff.tables.find((t) => t.id === "t-users")!;
  assert.equal(usersDiff.status, "changed");
  assert.equal(usersDiff.renamedFrom, undefined);

  const byId = new Map(usersDiff.fields.map((f) => [f.id, f]));
  assert.equal(byId.get("f-email")?.status, "removed");
  assert.equal(byId.get("f-name")?.status, "added");
  assert.equal(byId.get("f-id")?.status, "changed");
});

test("ref added/removed/changed", () => {
  const before = baseProject();
  before.refs = [
    {
      id: "r1",
      from: { tableId: "t-legacy", fieldId: "f-legacy-id" },
      to: { tableId: "t-users", fieldId: "f-id" },
      cardinality: "one-to-many",
    },
    {
      id: "r-removed",
      from: { tableId: "t-users", fieldId: "f-id" },
      to: { tableId: "t-legacy", fieldId: "f-legacy-id" },
      cardinality: "one-to-one",
    },
  ];
  const after = structuredClone(before);
  after.refs = [
    { ...after.refs[0], cardinality: "many-to-many" }, // r1 changed
    // r-removed dropped
  ];
  after.refs.push({
    id: "r-added",
    from: { tableId: "t-users", fieldId: "f-email" },
    to: { tableId: "t-legacy", fieldId: "f-legacy-id" },
    cardinality: "one-to-one",
  });

  const diff = diffProjects(before, after);
  const byId = new Map(diff.refs.map((r) => [r.id, r]));
  assert.equal(byId.get("r1")?.status, "changed");
  assert.equal(byId.get("r-removed")?.status, "removed");
  assert.equal(byId.get("r-added")?.status, "added");
});
