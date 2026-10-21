import { test } from "node:test";
import assert from "node:assert/strict";
import type { Table } from "@nebuladb/shared";
import { estimateLiteSize } from "./liteSize";

const table = (detailLevel: Table["detailLevel"], name = "customers"): Table =>
  ({ id: "t", name, fields: [], indexes: [], position: { x: 0, y: 0 }, detailLevel }) as unknown as Table;

test("height is the header, 27px a column and the footer — exact on a measured schema", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ name: `c${i}`, type: "int" }));
  assert.equal(estimateLiteSize(table("full"), rows).height, 65 + 27 * 11);
});

test("a compact table is only its header", () => {
  assert.deepEqual(estimateLiteSize(table("compact"), []), { width: 190, height: 34 });
});

test("width follows the longest column and stays within the node's bounds", () => {
  const short = estimateLiteSize(table("full"), [{ name: "id", type: "int" }]);
  const long = estimateLiteSize(table("full"), [{ name: "a_very_long_column_name_indeed", type: "varchar(255)" }]);
  const huge = estimateLiteSize(table("full"), [{ name: "x".repeat(200), type: "text" }]);
  assert.ok(short.width >= 190 && long.width > short.width);
  assert.equal(huge.width, 420);
});
