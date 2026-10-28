import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Table } from "@nebuladb/shared";
import { diffTargetAgainstLive, typesMatch } from "./migrationDiff.js";

function projectOf(fields: Field[]): Project {
  const table: Table = {
    id: "t",
    name: "t",
    fields,
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
  return { id: "p", name: "p", tables: [table], refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

test("a database that reads a size, a default or a key back its own way is not a change", () => {
  const live = projectOf([
    { id: "a", name: "id", type: "int", pk: true, notNull: true },
    { id: "b", name: "hash", type: "char", notNull: true },
    { id: "c", name: "n", type: "int", notNull: true, default: "((0))" },
    { id: "d", name: "s", type: "varchar", default: "('x')" },
  ]);
  const written = projectOf([
    { id: "a", name: "id", type: "int", pk: true, unique: true, notNull: true },
    { id: "b", name: "hash", type: "char(64)", notNull: true },
    { id: "c", name: "n", type: "int", notNull: true, default: "0" },
    { id: "d", name: "s", type: "varchar(255)", default: "x" },
  ]);
  assert.equal(diffTargetAgainstLive(live, written).hasChanges, false);
});

test("a size that differs on both sides is still a change", () => {
  assert.equal(typesMatch("char(32)", "char(64)"), false);
  assert.equal(typesMatch("char", "char(64)"), true);
});
