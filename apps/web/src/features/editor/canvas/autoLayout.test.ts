import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ref, Table, TableGroup, Zone } from "@athanordb/shared";
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

function makeZone(id: string, position: { x: number; y: number }, size: { width: number; height: number }): Zone {
  return { id, label: id, position, size };
}

function makeGroup(id: string, tableIds: string[]): TableGroup {
  return { id, name: id, tableIds };
}

test("every table gets a position", () => {
  const tables = [makeTable("a"), makeTable("b"), makeTable("c")];
  const { tables: positions } = computeAutoLayout(tables, []);
  assert.equal(positions.size, 3);
  for (const t of tables) assert.ok(positions.has(t.id));
});

test("a ref's target lands to the right of its source (rankdir LR)", () => {
  const tables = [makeTable("parent"), makeTable("child")];
  const { tables: positions } = computeAutoLayout(tables, [makeRef("r1", "parent", "child")]);
  const parentPos = positions.get("parent")!;
  const childPos = positions.get("child")!;
  assert.ok(childPos.x > parentPos.x, `expected child (${childPos.x}) right of parent (${parentPos.x})`);
});

test("a chain of refs lays out in rank order left-to-right", () => {
  const tables = [makeTable("a"), makeTable("b"), makeTable("c")];
  const refs = [makeRef("r1", "a", "b"), makeRef("r2", "b", "c")];
  const { tables: positions } = computeAutoLayout(tables, refs);
  assert.ok(positions.get("a")!.x < positions.get("b")!.x);
  assert.ok(positions.get("b")!.x < positions.get("c")!.x);
});

test("a self-referencing ref is skipped rather than breaking the layout", () => {
  const tables = [makeTable("a")];
  const refs = [makeRef("self", "a", "a")];
  assert.doesNotThrow(() => computeAutoLayout(tables, refs));
  const { tables: positions } = computeAutoLayout(tables, refs);
  assert.equal(positions.size, 1);
});

test("a ref pointing at a table that isn't in the list is skipped rather than breaking the layout", () => {
  const tables = [makeTable("a")];
  const refs = [makeRef("dangling", "a", "does-not-exist")];
  assert.doesNotThrow(() => computeAutoLayout(tables, refs));
  assert.equal(computeAutoLayout(tables, refs).tables.size, 1);
});

test("an empty project lays out to an empty map without throwing", () => {
  assert.equal(computeAutoLayout([], []).tables.size, 0);
});

test("a table group's members land closer to each other than to an unrelated table", () => {
  // No refs at all connecting them — the grouping alone should still pull "a" and "b" together.
  const tables = [makeTable("a"), makeTable("b"), makeTable("c")];
  const groups = [makeGroup("g1", ["a", "b"])];
  const { tables: positions } = computeAutoLayout(tables, [], [], groups);
  const a = positions.get("a")!;
  const b = positions.get("b")!;
  const c = positions.get("c")!;
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  assert.ok(dist(a, b) < dist(a, c), "grouped tables should sit closer together than to the ungrouped table");
});

test("a group of only one still-existing table is ignored (no single-member cluster)", () => {
  const tables = [makeTable("a"), makeTable("b")];
  const groups = [makeGroup("g1", ["a", "does-not-exist"])];
  assert.doesNotThrow(() => computeAutoLayout(tables, [], [], groups));
});

test("a zone with two or more member tables gets resized/repositioned to wrap its post-layout cluster", () => {
  const tables = [makeTable("a"), makeTable("b")];
  const zones = [makeZone("z1", { x: 0, y: 0 }, { width: 500, height: 500 })];
  const { zones: zoneUpdates } = computeAutoLayout(tables, [], zones);
  assert.ok(zoneUpdates.has("z1"));
  const update = zoneUpdates.get("z1")!;
  assert.ok(update.size.width > 0 && update.size.height > 0);
});

test("a zone with fewer than two member tables is left untouched", () => {
  const tables = [makeTable("a", 1)];
  const zones = [makeZone("z1", { x: 0, y: 0 }, { width: 500, height: 500 })];
  const { zones: zoneUpdates } = computeAutoLayout(tables, [], zones);
  assert.equal(zoneUpdates.has("z1"), false);
});

test("many unrelated tables spread across both axes instead of piling into one vertical column", () => {
  // No refs, no groups, no zones connecting any of these — a plain dagre pass
  // would put every one of them in the same rank, stacked in a single column.
  const tables = Array.from({ length: 20 }, (_, i) => makeTable(`t${i}`));
  const { tables: positions } = computeAutoLayout(tables, []);

  const xs = new Set(Array.from(positions.values()).map((p) => Math.round(p.x)));
  const ys = new Set(Array.from(positions.values()).map((p) => Math.round(p.y)));
  assert.ok(xs.size > 1, "tables should spread across more than one x position");
  assert.ok(ys.size > 1, "tables should spread across more than one y position");

  const maxX = Math.max(...Array.from(positions.values()).map((p) => p.x));
  const maxY = Math.max(...Array.from(positions.values()).map((p) => p.y));
  assert.ok(maxX > 0, "layout should have real width, not just a single column at x=0");
  // A single vertical strip would have maxY many multiples of maxX; a packed
  // grid keeps the overall shape roughly balanced instead.
  assert.ok(maxY < maxX * 4, `expected a roughly balanced layout, got maxX=${maxX} maxY=${maxY}`);
});

test("independent components stay well apart from each other", () => {
  const tables = [makeTable("a"), makeTable("b"), makeTable("c"), makeTable("d")];
  const refs = [makeRef("r1", "a", "b"), makeRef("r2", "c", "d")]; // two disjoint pairs
  const { tables: positions } = computeAutoLayout(tables, refs);

  // Bounding-box separation, not point-to-point distance — the two
  // components can be wide-and-short or tall-and-thin depending on how the
  // grid packs them, so a straight-line distance between two arbitrary
  // corners isn't a reliable stand-in for "is there a real gap between them".
  // Matches autoLayout.ts's own NODE_WIDTH/table-height-with-no-visible-rows —
  // not exported, so mirrored here just for this bounding-box check.
  const TABLE_WIDTH = 200;
  const TABLE_HEIGHT = 30;
  const box = (ids: string[]) => {
    const points = ids.map((id) => positions.get(id)!);
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)) + TABLE_WIDTH,
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)) + TABLE_HEIGHT,
    };
  };
  const boxA = box(["a", "b"]);
  const boxB = box(["c", "d"]);
  const separatedOnX = boxA.maxX <= boxB.minX || boxB.maxX <= boxA.minX;
  const separatedOnY = boxA.maxY <= boxB.minY || boxB.maxY <= boxA.minY;
  assert.ok(separatedOnX || separatedOnY, "the two components' bounding boxes should not overlap");
});

test("a hub table's many children spread into a grid instead of one tall column", () => {
  const hub = makeTable("hub");
  const children = Array.from({ length: 10 }, (_, i) => makeTable(`child${i}`));
  const refs = children.map((c, i) => makeRef(`r${i}`, "hub", c.id));
  const { tables: positions } = computeAutoLayout([hub, ...children], refs);

  const childXs = new Set(children.map((c) => Math.round(positions.get(c.id)!.x)));
  assert.ok(childXs.size > 1, "the hub's children should spread across more than one x position, not just y");

  const ys = children.map((c) => positions.get(c.id)!.y);
  const height = Math.max(...ys) - Math.min(...ys);
  // 10 children stacked in a single column (the old behaviour) would need
  // roughly 10 * (tableHeight + gap) ≈ 900px of vertical space; a grid keeps
  // it far shorter.
  assert.ok(height < 400, `expected a compact grid, got a ${height}px-tall spread of children`);
});

test("a rank with only a couple of items stays a plain column (grid reflow only kicks in once it's actually wide)", () => {
  const hub = makeTable("hub");
  const children = [makeTable("child0"), makeTable("child1")];
  const refs = children.map((c, i) => makeRef(`r${i}`, "hub", c.id));
  const { tables: positions } = computeAutoLayout([hub, ...children], refs);

  const childXs = new Set(children.map((c) => Math.round(positions.get(c.id)!.x)));
  assert.equal(childXs.size, 1, "two children should still line up in a single column");
});
