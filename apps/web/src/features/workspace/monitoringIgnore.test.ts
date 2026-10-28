import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IGNORE_NAME,
  MAX_IGNORE_TABLES,
  matchingTables,
  pickableTables,
  toggleIgnoredTable,
  typedTableName,
} from "./monitoringIgnore";

test("offers each table once and drops names the server would refuse", () => {
  assert.deepEqual(pickableTables(["a", "b", "a", "x".repeat(MAX_IGNORE_NAME + 1)]), ["a", "b"]);
});

test("filters by what was typed, case aside", () => {
  assert.deepEqual(matchingTables(["Orders", "users"], " ORD "), ["Orders"]);
  assert.deepEqual(matchingTables(["Orders", "users"], "  "), ["Orders", "users"]);
});

test("accepts a typed name only when it is new", () => {
  assert.equal(typedTableName(["a"], ["b"], " c "), "c");
  assert.equal(typedTableName(["a"], ["b"], "a"), null);
  assert.equal(typedTableName(["a"], ["b"], "b"), null);
  assert.equal(typedTableName(["a"], [], "  "), null);
});

test("adds and removes names, leaving the list alone when nothing changes", () => {
  const list = ["a"];
  assert.deepEqual(toggleIgnoredTable(list, "b", true), ["a", "b"]);
  assert.equal(toggleIgnoredTable(list, "a", true), list);
  assert.deepEqual(toggleIgnoredTable(list, "a", false), []);
  assert.equal(toggleIgnoredTable(list, "z", false), list);
});

test("stops adding at the server's cap", () => {
  const full = Array.from({ length: MAX_IGNORE_TABLES }, (_, i) => `t${i}`);
  assert.equal(toggleIgnoredTable(full, "extra", true), full);
  assert.equal(toggleIgnoredTable(full, "t0", false).length, MAX_IGNORE_TABLES - 1);
});
