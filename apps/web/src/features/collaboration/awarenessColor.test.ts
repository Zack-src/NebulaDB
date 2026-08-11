import { test } from "node:test";
import assert from "node:assert/strict";
import { hashColor } from "@/features/collaboration/awarenessColor";

test("hashColor is deterministic — the same seed always produces the same color", () => {
  assert.equal(hashColor("alice"), hashColor("alice"));
  assert.equal(hashColor(""), hashColor(""));
});

test("hashColor produces a valid hsl() string with a hue in [0, 360)", () => {
  for (const seed of ["alice", "bob", "", "a very long display name indeed"]) {
    const color = hashColor(seed);
    const match = /^hsl\((\d+), 70%, 45%\)$/.exec(color);
    assert.ok(match, `expected an hsl() string, got ${color}`);
    const hue = Number(match![1]);
    assert.ok(hue >= 0 && hue < 360, `hue ${hue} out of range`);
  }
});

test("hashColor gives different seeds different hues (not guaranteed collision-free, but these shouldn't collide)", () => {
  const colors = new Set(["alice", "bob", "carol", "dave"].map(hashColor));
  assert.equal(colors.size, 4);
});
