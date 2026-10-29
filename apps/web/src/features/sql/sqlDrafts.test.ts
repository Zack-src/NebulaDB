import assert from "node:assert/strict";
import test from "node:test";
import { getSqlDraft, setSqlDraft } from "./sqlDrafts.js";

test("a draft comes back for the same key and not for another", () => {
  setSqlDraft("conn-a", "SELECT 1");
  assert.equal(getSqlDraft("conn-a"), "SELECT 1");
  assert.equal(getSqlDraft("conn-b"), "");
});

test("clearing a draft empties it", () => {
  setSqlDraft("conn-c", "SELECT 2");
  setSqlDraft("conn-c", "");
  assert.equal(getSqlDraft("conn-c"), "");
});
