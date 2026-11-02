import { test } from "node:test";
import assert from "node:assert/strict";

// `preferences` reads and writes localStorage; a plain Map stands in for it here.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

const { carryViewToProject, takeKeepTab, takeDbmlView } = await import("./viewCarry");
const { loadViewport, saveViewport } = await import("./preferences");

test("switching variant copies the canvas view to the target and keeps the tab once", () => {
  saveViewport("original", "u1", { x: 120, y: -40, zoom: 0.5 });
  carryViewToProject("original", "variant", "u1");
  assert.deepEqual(loadViewport("variant", "u1"), { x: 120, y: -40, zoom: 0.5 });
  // Only the project switched to takes it, and only once.
  assert.equal(takeKeepTab("elsewhere"), false);
  assert.equal(takeKeepTab("variant"), true);
  assert.equal(takeKeepTab("variant"), false);
  // No editor was on screen: nothing to put back in the code.
  assert.equal(takeDbmlView("variant"), null);
});

test("a view the original never moved leaves the target's own alone", () => {
  saveViewport("target-own", "u2", { x: 1, y: 2, zoom: 1 });
  carryViewToProject("never-moved", "target-own", "u2");
  assert.deepEqual(loadViewport("target-own", "u2"), { x: 1, y: 2, zoom: 1 });
});
