import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { readProjectFromDoc, writeProjectToDoc, type Project, type Table } from "@nebuladb/shared";
import { addIndexToDoc } from "./indexSuggestionActions";

function table(id: string, name: string, fields: string[], indexes: Table["indexes"] = []): Table {
  return {
    id,
    name,
    fields: fields.map((field) => ({ id: `${id}-${field}`, name: field, type: "int", pk: field === "id" })),
    indexes,
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

function docWith(...tables: Table[]): Y.Doc {
  const doc = new Y.Doc();
  const project: Project = {
    id: "p",
    name: "Shop",
    tables,
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  writeProjectToDoc(doc, project);
  return doc;
}

test("the index is added to the project's table, as the linter's foreign-key fix does", () => {
  const doc = docWith(table("t1", "orders", ["id", "customer_id", "status"]));
  assert.equal(addIndexToDoc(doc, { table: "Orders", schema: null, columns: ["customer_id", "status"] }), "added");
  const [orders] = readProjectFromDoc(doc, "p", "Shop").tables;
  assert.equal(orders.indexes.length, 1);
  assert.deepEqual(orders.indexes[0].fieldIds, ["t1-customer_id", "t1-status"]);
  assert.ok(orders.indexes[0].id);
  // Adding it again changes nothing.
  assert.equal(addIndexToDoc(doc, { table: "orders", schema: null, columns: ["customer_id"] }), "exists");
  assert.equal(readProjectFromDoc(doc, "p", "Shop").tables[0].indexes.length, 1);
});

test("a table or a column the schema does not have, or an index it already has, changes nothing", () => {
  const doc = docWith(table("t1", "orders", ["id", "customer_id"], [{ id: "i1", fieldIds: ["t1-customer_id"] }]));
  assert.equal(addIndexToDoc(doc, { table: "ghosts", schema: null, columns: ["id"] }), "missing");
  assert.equal(addIndexToDoc(doc, { table: "orders", schema: null, columns: ["nope"] }), "missing");
  assert.equal(addIndexToDoc(doc, { table: "orders", schema: null, columns: ["customer_id"] }), "exists");
  assert.equal(addIndexToDoc(doc, { table: "orders", schema: null, columns: ["id"] }), "exists");
  assert.equal(readProjectFromDoc(doc, "p", "Shop").tables[0].indexes.length, 1);
});
