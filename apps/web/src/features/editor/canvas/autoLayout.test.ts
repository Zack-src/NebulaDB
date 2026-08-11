import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ref, Table } from "@athanordb/shared";
import { computeAutoLayout } from "@/features/editor/canvas/autoLayout";

function makeTable(id: string, fieldCount = 1): Table {
  return {
    id,
    name: id,
    fields: Array.from({ length: fieldCount }, (_, i) => ({ id: `${id}-f${i}`, name: `f${i}`, type: "int" })),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

function makeRef(id: string, fromTable: string, toTable: string): Ref {
  return {
    id,
    from: { tableId: fromTable, fieldId: `${fromTable}-f0` },
    to: { tableId: toTable, fieldId: `${toTable}-f0` },
    cardinality: "one-to-many",
  };
}

test("every table gets a position", () => {
  const tables = [makeTable("a"), makeTable("b"), makeTable("c")];
  const positions = computeAutoLayout(tables, []);
  assert.equal(positions.size, 3);
  for (const t of tables) assert.ok(positions.has(t.id));
});

test("a ref's target lands to the right of its source (rankdir LR)", () => {
  const tables = [makeTable("parent"), makeTable("child")];
  const positions = computeAutoLayout(tables, [makeRef("r1", "parent", "child")]);
  const parentPos = positions.get("parent")!;
  const childPos = positions.get("child")!;
  assert.ok(childPos.x > parentPos.x, `expected child (${childPos.x}) right of parent (${parentPos.x})`);
});

test("a chain of refs lays out in rank order left-to-right", () => {
  const tables = [makeTable("a"), makeTable("b"), makeTable("c")];
  const refs = [makeRef("r1", "a", "b"), makeRef("r2", "b", "c")];
  const positions = computeAutoLayout(tables, refs);
  assert.ok(positions.get("a")!.x < positions.get("b")!.x);
  assert.ok(positions.get("b")!.x < positions.get("c")!.x);
});

test("a self-referencing ref is skipped rather than breaking the layout", () => {
  const tables = [makeTable("a")];
  const refs = [makeRef("self", "a", "a")];
  assert.doesNotThrow(() => computeAutoLayout(tables, refs));
  const positions = computeAutoLayout(tables, refs);
  assert.equal(positions.size, 1);
});

test("a ref pointing at a table that isn't in the list is skipped rather than breaking the layout", () => {
  const tables = [makeTable("a")];
  const refs = [makeRef("dangling", "a", "does-not-exist")];
  assert.doesNotThrow(() => computeAutoLayout(tables, refs));
  assert.equal(computeAutoLayout(tables, refs).size, 1);
});

test("an empty project lays out to an empty map without throwing", () => {
  assert.equal(computeAutoLayout([], []).size, 0);
});
