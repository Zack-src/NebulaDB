import { test } from "node:test";
import assert from "node:assert/strict";
import type { SchemaComparisonEntry } from "@nebuladb/dbml-engine";
import { canCompare, comparisonPair, countByStatus, detailRows } from "./compareEnvironments";

test("comparisonPair: current database is the target, another one the source", () => {
  assert.deepEqual(comparisonPair(["a", "b", "c"], "b", { source: null, target: null }), {
    sourceId: "a",
    targetId: "b",
  });
  assert.deepEqual(comparisonPair(["a", "b"], null, { source: null, target: null }), { sourceId: "b", targetId: "a" });
});

test("comparisonPair: explicit choices win", () => {
  assert.deepEqual(comparisonPair(["a", "b", "c"], "a", { source: "c", target: "b" }), {
    sourceId: "c",
    targetId: "b",
  });
});

test("canCompare refuses empty or identical sides", () => {
  assert.equal(canCompare("a", "b"), true);
  assert.equal(canCompare("a", "a"), false);
  assert.equal(canCompare("", "b"), false);
});

const entry = (status: SchemaComparisonEntry["status"], detail?: SchemaComparisonEntry["detail"]) => ({
  name: "t",
  status,
  inSchema: true,
  detail,
});

test("countByStatus", () => {
  assert.deepEqual(countByStatus([entry("only-source"), entry("different"), entry("different")]), {
    "only-source": 1,
    "only-target": 0,
    different: 2,
  });
});

test("detailRows flattens a different table and is null without detail", () => {
  assert.equal(detailRows(entry("only-source")), null);
  const rows = detailRows(
    entry("different", {
      columnsAdded: ["a"],
      columnsRemoved: ["b"],
      columnsChanged: [{ name: "c", before: "int", after: "text" }],
      primaryKeyChanged: true,
      indexesChanged: false,
      foreignKeysChanged: true,
    }),
  );
  assert.deepEqual(rows, {
    onlyInSource: ["b"],
    onlyInTarget: ["a"],
    changed: [{ name: "c", before: "int", after: "text" }],
    flags: ["primaryKey", "foreignKeys"],
  });
});
