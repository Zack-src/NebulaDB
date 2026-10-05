import assert from "node:assert/strict";
import { test } from "node:test";
import { shellHash, shellViewFromHash } from "./shellNavigation";

test("global links cannot expose administrator destinations to a member", () => {
  for (const hash of ["#admin"]) {
    assert.equal(shellViewFromHash(hash, false), "app");
  }
  assert.equal(shellViewFromHash("#settings", false), "settings");
  assert.equal(shellViewFromHash("#bases", false), "bases");
  assert.equal(shellViewFromHash("#home", false), "app");
});

test("shell navigation preserves the root and ignores unrelated hash routes", () => {
  assert.equal(shellHash("app"), "");
  assert.equal(shellViewFromHash("#components", true), "app");
  assert.equal(shellViewFromHash("", true), "app");
  for (const view of ["bases", "admin", "settings"] as const) {
    assert.equal(shellViewFromHash(shellHash(view), true), view);
  }
});
