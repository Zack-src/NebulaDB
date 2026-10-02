import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Table } from "@athanordb/shared";
import { parseDbml, toProject } from "@athanordb/dbml-engine";
import {
  copyTables,
  instantiateClipboard,
  parseClipboard,
  serializeClipboard,
  uniqueCopyName,
} from "@/features/editor/canvas/tableClipboard";

const table = (id: string, name: string, extra: Partial<Table> = {}): Table => ({
  id,
  name,
  fields: [
    { id: `${id}-id`, name: "id", type: "int", pk: true },
    { id: `${id}-ref`, name: "other_id", type: "int", default: "now()", defaultKind: "expression" },
  ],
  indexes: [{ id: `${id}-idx`, fieldIds: [`${id}-ref`], unique: true }],
  position: { x: 100, y: 200 },
  detailLevel: "full",
  ...extra,
});

const project: Project = {
  id: "p",
  name: "p",
  tables: [
    table("u", "users", { style: { color: "#ff0000" }, size: { width: 300, height: 120 }, note: "people" }),
    table("o", "orders", {
      position: { x: 500, y: 260 },
      comments: [{ id: "c", author: "a", text: "hm", createdAt: "2026-01-01" }],
    }),
    table("i", "invoices"),
  ],
  refs: [
    {
      id: "r1",
      from: { tableId: "o", fieldId: "o-ref" },
      to: { tableId: "u", fieldId: "u-id" },
      cardinality: "one-to-many",
      onDelete: "cascade",
      routingPoints: [{ x: 1, y: 2 }],
    },
    {
      id: "r2",
      from: { tableId: "i", fieldId: "i-ref" },
      to: { tableId: "o", fieldId: "o-id" },
      cardinality: "one-to-many",
    },
  ],
  enums: [],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
};

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

test("copy keeps the selected tables and only the relations between them", () => {
  const clipboard = copyTables(project, ["u", "o"]);
  assert.deepEqual(
    clipboard?.tables.map((t) => t.name),
    ["users", "orders"],
  );
  assert.deepEqual(
    clipboard?.refs.map((r) => r.id),
    ["r1"],
    "the relation to `invoices`, which was not copied, is left out",
  );
  assert.equal(clipboard?.tables[1].comments, undefined);
  assert.equal(copyTables(project, []), null);
  assert.equal(copyTables(project, ["nope"]), null);
});

test("the clipboard text is valid DBML and round-trips colours, sizes and settings", () => {
  const clipboard = copyTables(project, ["u", "o"])!;
  const text = serializeClipboard(clipboard);

  // what lands in the DBML editor (or any text field)
  const parsed = toProject(parseDbml(text), "p", text);
  assert.deepEqual(
    parsed.tables.map((t) => t.name),
    ["users", "orders"],
  );
  assert.equal(parsed.refs.length, 1);

  const back = parseClipboard(text)!;
  assert.deepEqual(back.tables, clipboard.tables);
  assert.equal(back.tables[0].style?.color, "#ff0000");
  assert.equal(back.refs[0].onDelete, "cascade");
  // survives a clipboard that normalised line endings or wrapped it in other text
  assert.deepEqual(parseClipboard(`pasted from a chat:\n${text}\nthanks`)?.tables, clipboard.tables);
});

test("paste gives new ids and `_copy` names, retargets relations, and keeps everything else", () => {
  const clipboard = copyTables(project, ["u", "o"])!;
  const pasted = instantiateClipboard(clipboard, project.tables, {}, counter());

  assert.deepEqual(
    pasted.tables.map((t) => t.name),
    ["users_copy", "orders_copy"],
  );
  const [users, orders] = pasted.tables;
  assert.deepEqual(users.style, { color: "#ff0000" });
  assert.deepEqual(users.size, { width: 300, height: 120 });
  assert.equal(users.detailLevel, "full");
  assert.equal(users.note, "people");
  assert.deepEqual(
    users.fields.map((f) => [f.name, f.type, f.default]),
    project.tables[0].fields.map((f) => [f.name, f.type, f.default]),
  );
  assert.deepEqual(users.position, { x: 124, y: 224 });

  const ids = [
    ...pasted.tables.flatMap((t) => [t.id, ...t.fields.map((f) => f.id), ...t.indexes.map((x) => x.id)]),
    pasted.refs[0].id,
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("new-")));
  assert.deepEqual(orders.indexes[0].fieldIds, [orders.fields[1].id]);

  const [ref] = pasted.refs;
  assert.deepEqual(ref.from, { tableId: orders.id, fieldId: orders.fields[1].id });
  assert.deepEqual(ref.to, { tableId: users.id, fieldId: users.fields[0].id });
  assert.equal(ref.onDelete, "cascade");
  assert.equal(ref.routingPoints, undefined);
});

test("names stay unique across repeated pastes, and a right-click paste lands at the cursor", () => {
  const clipboard = copyTables(project, ["u", "o"])!;
  const first = instantiateClipboard(clipboard, project.tables, {}, counter());
  const second = instantiateClipboard(clipboard, [...project.tables, ...first.tables], { repeat: 1 }, counter());
  assert.deepEqual(
    second.tables.map((t) => t.name),
    ["users_copy2", "orders_copy2"],
  );
  assert.deepEqual(second.tables[0].position, { x: 148, y: 248 });

  // copying a copy does not pile suffixes up
  assert.equal(uniqueCopyName("users_copy2", new Set(["users", "users_copy", "users_copy2"])), "users_copy3");
  assert.equal(uniqueCopyName("Users", new Set(["users", "users_copy"])), "Users_copy2");

  const atCursor = instantiateClipboard(clipboard, [], { at: { x: 1000, y: 1000 } }, counter());
  assert.deepEqual(
    atCursor.tables.map((t) => t.position),
    [
      { x: 1000, y: 1000 },
      { x: 1400, y: 1060 },
    ],
    "the group keeps its shape",
  );
});

test("a clipboard written by something else is rebuilt field by field, or refused", () => {
  assert.equal(parseClipboard("Table users {\n  id int\n}"), null, "plain DBML is not pasteable on the canvas");
  assert.equal(parseClipboard("// athanordb-clipboard:v1 {not json"), null);
  assert.equal(parseClipboard('// athanordb-clipboard:v1 {"tables":[{"id":"a","name":"a","fields":[]}]}'), null);

  const hostile = {
    tables: [
      {
        id: "a",
        name: "x".repeat(5000),
        __proto__: { polluted: true },
        comments: [{ text: "injected" }],
        detailLevel: "enormous",
        position: { x: "left", y: Infinity },
        style: { color: 12, borderColor: "#000", extra: "x" },
        fields: [{ id: "f", name: "id", type: 7, pk: "yes", note: { a: 1 } }, "junk", { id: "g" }],
        indexes: [{ fieldIds: ["f", "missing"] }, { fieldIds: ["missing"] }],
      },
      "junk",
    ],
    refs: [
      { from: { tableId: "a", fieldId: "f" }, to: { tableId: "elsewhere", fieldId: "f" }, cardinality: "one-to-many" },
    ],
  };
  const parsed = parseClipboard(`// athanordb-clipboard:v1 ${JSON.stringify(hostile)}`)!;
  assert.equal(parsed.tables.length, 1);
  const [only] = parsed.tables;
  assert.equal(only.name.length, 200);
  assert.deepEqual(Object.keys(only).sort(), ["detailLevel", "fields", "id", "indexes", "name", "position", "style"]);
  assert.equal(only.detailLevel, "standard");
  assert.deepEqual(only.position, { x: 0, y: 0 });
  assert.deepEqual(only.style, { borderColor: "#000" });
  assert.deepEqual(only.fields, [{ id: "f", name: "id", type: "" }]);
  assert.deepEqual(
    only.indexes.map((index) => index.fieldIds),
    [["f"]],
  );
  assert.deepEqual(parsed.refs, [], "a relation pointing outside the clipboard is dropped");
});
