import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHandleSides, type TableBox } from "@/features/editor/edges/refGeometry";

const box = (x: number, y: number, width = 200, height = 100): TableBox => ({ x, y, width, height });

test("side-by-side tables exit toward each other (the shortest path)", () => {
  const left = box(0, 0);
  const right = box(400, 0);
  assert.deepEqual(pickHandleSides(left, right), { fromSide: "right", toSide: "left" });
  assert.deepEqual(pickHandleSides(right, left), { fromSide: "left", toSide: "right" });
});

test("vertically stacked tables (overlapping on X) exit from the same side, not opposite ones", () => {
  const top = box(0, 0);
  const bottom = box(20, 300); // shifted right a little, but still overlapping on X
  const result = pickHandleSides(top, bottom);
  assert.equal(result.fromSide, result.toSide, "opposite sides would force an unnecessary detour across the table");
});

test("a table directly below and to the right picks the side matching its horizontal offset", () => {
  const top = box(0, 0);
  const bottomRight = box(50, 300);
  assert.deepEqual(pickHandleSides(top, bottomRight), { fromSide: "right", toSide: "right" });

  const bottomLeft = box(-50, 300);
  assert.deepEqual(pickHandleSides(top, bottomLeft), { fromSide: "left", toSide: "left" });
});

test("identical positions (dx=0) default to the right/left pair rather than throwing", () => {
  const a = box(0, 0);
  const b = box(0, 0);
  assert.deepEqual(pickHandleSides(a, b), { fromSide: "right", toSide: "left" });
});
