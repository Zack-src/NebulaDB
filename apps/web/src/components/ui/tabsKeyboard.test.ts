import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex } from "@/components/ui/tabsKeyboard";

describe("nextTabIndex", () => {
  it("wraps with the arrow keys", () => {
    assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
    assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
    assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
  });
  it("jumps to the ends with Home / End", () => {
    assert.equal(nextTabIndex("Home", 2, 4), 0);
    assert.equal(nextTabIndex("End", 0, 4), 3);
  });
  it("ignores other keys and empty lists", () => {
    assert.equal(nextTabIndex("a", 0, 3), null);
    assert.equal(nextTabIndex("ArrowRight", -1, 3), null);
    assert.equal(nextTabIndex("Home", 0, 0), null);
  });
});
