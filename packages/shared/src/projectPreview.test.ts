import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Table } from "./schema.js";
import { buildProjectPreview, estimateTableBox, PREVIEW_DBML_LINES } from "./projectPreview.js";

const table = (id: string, detailLevel: Table["detailLevel"], fields: { id: string; name: string; type: string; pk?: boolean }[], x = 0): Table =>
  ({ id, name: id, fields, indexes: [], position: { x, y: 0 }, detailLevel }) as unknown as Table;

test("a table's height is the header, 27px a column and the footer", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ name: `c${i}`, type: "int" }));
  assert.equal(estimateTableBox({ name: "t", detailLevel: "full" }, rows).height, 65 + 27 * 11);
});

test("a compact table is its header alone, and the width stays inside the node's bounds", () => {
  assert.deepEqual(estimateTableBox({ name: "t", detailLevel: "compact" }, []), { width: 190, height: 34 });
  assert.equal(estimateTableBox({ name: "t", detailLevel: "full" }, [{ name: "x".repeat(200), type: "text" }]).width, 420);
});

test("the preview places each table and joins the ends of each relation", () => {
  const project = {
    id: "p",
    name: "p",
    tables: [
      table("a", "full", [{ id: "a1", name: "id", type: "int", pk: true }]),
      table("b", "standard", [{ id: "b1", name: "id", type: "int", pk: true }, { id: "b2", name: "a_id", type: "int" }, { id: "b3", name: "note", type: "text" }], 300),
    ],
    refs: [{ id: "r", from: { tableId: "b", fieldId: "b2" }, to: { tableId: "a", fieldId: "a1" }, cardinality: "many-to-one" }],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  } as unknown as Project;
  const preview = buildProjectPreview(project, Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n"));
  assert.deepEqual(preview.edges, [[1, 0]]);
  assert.equal(preview.nodes[1].x, 300);
  // Standard detail shows the keys and the foreign-key column, not "note": 2 rows.
  assert.equal(preview.nodes[1].h, 65 + 27 * 2);
  assert.equal(preview.dbml.split("\n").length, PREVIEW_DBML_LINES);
  assert.equal(preview.totalLines, 200);
});
