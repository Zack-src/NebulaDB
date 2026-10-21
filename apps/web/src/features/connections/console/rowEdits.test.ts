import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DbRowEditColumn, DbRowEditing } from "@nebuladb/shared";
import {
  NO_EDITS,
  addInsert,
  cellId,
  cellProblem,
  countEdits,
  displayedRows,
  removeInsert,
  rowIdentity,
  setCell,
  setInsertCell,
  toOperations,
  toggleDelete,
} from "./rowEdits";

function column(name: string, extra: Partial<DbRowEditColumn> = {}): DbRowEditColumn {
  return {
    name,
    type: "text",
    kind: "text",
    nullable: true,
    hasDefault: false,
    primaryKey: false,
    readOnly: null,
    ...extra,
  };
}

const editing: DbRowEditing = {
  editable: true,
  reason: null,
  key: ["id"],
  columns: [column("id", { kind: "integer", primaryKey: true, nullable: false }), column("name"), column("note")],
  maxOperations: 200,
  maxBytes: 1024,
};
const columns = ["id", "name", "note"];
const rows = [
  ["9007199254740993", "Ada", null],
  ["2", "Linus", ""],
];
const ada = rowIdentity(editing, columns, rows[0])!;
const linus = rowIdentity(editing, columns, rows[1])!;

describe("pending row edits", () => {
  it("identifies a row by its whole key, as text, and not when the key is NULL or cut", () => {
    assert.equal(ada, '["9007199254740993"]');
    assert.equal(rowIdentity(editing, columns, [null, "x", null]), null);
    assert.equal(rowIdentity(editing, columns, rows[0], new Set([cellId(0, 0)]), 0), null);
  });

  it("keeps a changed cell, and forgets it once set back to what was read", () => {
    let edits = setCell(NO_EDITS, editing, columns, rows[0], ada, "name", "Ada L.");
    assert.deepEqual(edits.rows[ada].values, { name: "Ada L." });
    assert.deepEqual(edits.rows[ada].key, { id: "9007199254740993" });
    edits = setCell(edits, editing, columns, rows[0], ada, "name", "Ada");
    assert.deepEqual(edits.rows, {});
    assert.equal(countEdits(edits).total, 0);
  });

  it("tells NULL from the empty string", () => {
    const toEmpty = setCell(NO_EDITS, editing, columns, rows[0], ada, "note", "");
    assert.deepEqual(toEmpty.rows[ada].values, { note: "" });
    const toNull = setCell(NO_EDITS, editing, columns, rows[1], linus, "note", null);
    assert.deepEqual(toNull.rows[linus].values, { note: null });
    assert.deepEqual(setCell(NO_EDITS, editing, columns, rows[0], ada, "note", null).rows, {});
  });

  it("marks a row deleted and back, keeping its changed cells", () => {
    let edits = setCell(NO_EDITS, editing, columns, rows[1], linus, "name", "L.");
    edits = toggleDelete(edits, editing, columns, rows[1], linus);
    assert.deepEqual(countEdits(edits), { insert: 0, update: 0, delete: 1, total: 1 });
    edits = toggleDelete(edits, editing, columns, rows[1], linus);
    assert.deepEqual(edits.rows[linus].values, { name: "L." });
    assert.equal(edits.rows[linus].deleted, false);
  });

  it("adds rows whose untouched columns are left to their defaults", () => {
    let edits = addInsert(addInsert(NO_EDITS));
    edits = setInsertCell(edits, 1, "name", "Grace");
    edits = setInsertCell(edits, 1, "note", null);
    edits = setInsertCell(edits, 1, "note", undefined);
    edits = removeInsert(edits, 2);
    assert.deepEqual(edits.inserts, [{ id: 1, values: { name: "Grace" } }]);
  });

  it("sends deletions, then changes with the read values of their edited cells, then inserts", () => {
    let edits = addInsert(NO_EDITS, { name: "Grace" });
    edits = setCell(edits, editing, columns, rows[0], ada, "note", "x");
    edits = toggleDelete(edits, editing, columns, rows[1], linus);
    assert.deepEqual(toOperations(edits), [
      { type: "delete", key: { id: "2" }, original: { id: "2", name: "Linus", note: "" } },
      { type: "update", key: { id: "9007199254740993" }, original: { note: null }, values: { note: "x" } },
      { type: "insert", values: { name: "Grace" } },
    ]);
  });

  it("shows the page as it will be: changed cells, deleted rows, added rows at the end", () => {
    let edits = setCell(NO_EDITS, editing, columns, rows[0], ada, "name", "Ada L.");
    edits = toggleDelete(edits, editing, columns, rows[1], linus);
    edits = addInsert(edits, { name: "Grace" });
    const shown = displayedRows(edits, editing, columns, rows, new Set());
    assert.deepEqual(shown.rows, [
      ["9007199254740993", "Ada L.", null],
      ["2", "Linus", ""],
      [null, "Grace", null],
    ]);
    assert.deepEqual(shown.tones, ["changed", "deleted", "added"]);
    assert.deepEqual([...shown.changed].sort(), [cellId(0, 1), cellId(2, 1)]);
    assert.deepEqual(shown.sources, [{ identity: ada }, { identity: linus }, { insert: 1 }]);
  });
});

describe("cell values", () => {
  it("takes numbers as digits, whatever their size, and refuses anything else", () => {
    const integer = column("n", { kind: "integer" });
    assert.equal(cellProblem(integer, "-9223372036854775808"), null);
    assert.equal(cellProblem(integer, "1.5"), "integer");
    assert.equal(cellProblem(integer, ""), "integer");
    const decimal = column("d", { kind: "decimal" });
    assert.equal(cellProblem(decimal, "12345678901234567890.0123456789"), null);
    assert.equal(cellProblem(decimal, "1e-3"), null);
    assert.equal(cellProblem(decimal, "NaN"), "number");
    assert.equal(cellProblem(decimal, "NaN", "postgres"), null);
  });

  it("checks JSON, and NULL against NOT NULL", () => {
    assert.equal(cellProblem(column("j", { kind: "json" }), '{"a": 1}'), null);
    assert.equal(cellProblem(column("j", { kind: "json" }), "{a: 1}"), "json");
    assert.equal(cellProblem(column("t", { nullable: false }), null), "required");
    assert.equal(cellProblem(column("t", { nullable: false }), ""), null);
  });
});
