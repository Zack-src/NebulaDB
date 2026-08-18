import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { dbmlSymbolsField } from "@/features/editor/dbml/symbols";
import { tableFieldAt } from "@/features/editor/dbml/canvasLink";

function stateFor(text: string): EditorState {
  return EditorState.create({ doc: text, extensions: [dbmlSymbolsField] });
}

const DBML = `Table users {
  id int [pk]
  email varchar
}

Table posts {
  id int [pk]
  author_id int
}
`;

test("double-clicking a table's declaration line resolves to that table, no field", () => {
  const state = stateFor(DBML);
  const pos = state.doc.line(1).from + 2; // inside "Table users {"
  assert.deepEqual(tableFieldAt(state, pos), { tableName: "users", fieldName: undefined });
});

test("double-clicking a column line resolves to that table and column", () => {
  const state = stateFor(DBML);
  const pos = state.doc.line(3).from + 2; // "  email varchar"
  assert.deepEqual(tableFieldAt(state, pos), { tableName: "users", fieldName: "email" });
});

test("double-clicking a different table's column resolves independently", () => {
  const state = stateFor(DBML);
  const pos = state.doc.line(8).from + 2; // "  author_id int" inside posts
  assert.deepEqual(tableFieldAt(state, pos), { tableName: "posts", fieldName: "author_id" });
});

test("double-clicking a buffer with no tables at all resolves to nothing", () => {
  const state = stateFor("// just a comment, no Table block\n");
  assert.equal(tableFieldAt(state, 0), null);
});
