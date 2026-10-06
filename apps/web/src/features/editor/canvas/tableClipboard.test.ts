import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Table } from "@nebuladb/shared";
import { parseDbml, toProject } from "@nebuladb/dbml-engine";
import {
  clipboardSize,
  copySelection,
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
  enums: [
    {
      id: "e1",
      name: "status",
      values: [
        { id: "e1-a", name: "open" },
        { id: "e1-b", name: "closed", note: "done" },
      ],
      position: { x: 40, y: 400 },
    },
  ],
  zones: [
    {
      id: "z1",
      label: "Billing",
      position: { x: 20, y: 30 },
      size: { width: 600, height: 400 },
      style: { color: "#00ff00" },
    },
  ],
  stickyNotes: [{ id: "n1", text: "check\nthis", position: { x: 700, y: 50 }, size: { width: 180, height: 90 } }],
  tableGroups: [],
};

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

test("copy keeps the selected tables and only the relations between them", () => {
  const clipboard = copySelection(project, { tableIds: ["u", "o"] });
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
  assert.equal(copySelection(project, { tableIds: [] }), null);
  assert.equal(copySelection(project, { tableIds: ["nope"] }), null);
});

test("the clipboard text is valid DBML and round-trips colours, sizes and settings", () => {
  const clipboard = copySelection(project, { tableIds: ["u", "o"] })!;
  const text = serializeClipboard(clipboard);

  // what lands in the DBML editor (or any text field)
  const parsed = toProject(parseDbml(text), "p", text);
  assert.deepEqual(
    parsed.tables.map((t) => t.name),
    ["users", "orders"],
  );
  assert.equal(parsed.refs.length, 1);

  const back = parseClipboard(text)!;
  assert.deepEqual(parseClipboard(text.replace("nebuladb-clipboard:v1", "athanordb-clipboard:v1")), back);
  assert.deepEqual(back.tables, clipboard.tables);
  assert.equal(back.tables[0].style?.color, "#ff0000");
  assert.equal(back.refs[0].onDelete, "cascade");
  // survives a clipboard that normalised line endings or wrapped it in other text
  assert.deepEqual(parseClipboard(`pasted from a chat:\n${text}\nthanks`)?.tables, clipboard.tables);
});

test("paste gives new ids and `_copy` names, retargets relations, and keeps everything else", () => {
  const clipboard = copySelection(project, { tableIds: ["u", "o"] })!;
  const pasted = instantiateClipboard(clipboard, { tables: project.tables }, {}, counter());

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
  const clipboard = copySelection(project, { tableIds: ["u", "o"] })!;
  const first = instantiateClipboard(clipboard, { tables: project.tables }, {}, counter());
  const second = instantiateClipboard(
    clipboard,
    { tables: [...project.tables, ...first.tables] },
    { repeat: 1 },
    counter(),
  );
  assert.deepEqual(
    second.tables.map((t) => t.name),
    ["users_copy2", "orders_copy2"],
  );
  assert.deepEqual(second.tables[0].position, { x: 148, y: 248 });

  // copying a copy does not pile suffixes up
  assert.equal(uniqueCopyName("users_copy2", new Set(["users", "users_copy", "users_copy2"])), "users_copy3");
  assert.equal(uniqueCopyName("Users", new Set(["users", "users_copy"])), "Users_copy2");

  const atCursor = instantiateClipboard(clipboard, { tables: [] }, { at: { x: 1000, y: 1000 } }, counter());
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
  assert.equal(parseClipboard("// nebuladb-clipboard:v1 {not json"), null);
  assert.equal(parseClipboard('// nebuladb-clipboard:v1 {"tables":[{"id":"a","name":"a","fields":[]}]}'), null);

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
  const parsed = parseClipboard(`// nebuladb-clipboard:v1 ${JSON.stringify(hostile)}`)!;
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

test("enums, zones and notes are copied with the tables, and pasted as fresh copies", () => {
  const clipboard = copySelection(project, {
    tableIds: ["u", "o"],
    enumIds: ["e1"],
    zoneIds: ["z1"],
    noteIds: ["n1"],
  })!;
  assert.equal(clipboardSize(clipboard), 5);
  assert.equal(copySelection(project, { tableIds: [], enumIds: ["e1"] })?.tables.length, 0);
  assert.equal(copySelection(project, { tableIds: [], zoneIds: ["nope"] }), null);

  const text = serializeClipboard(clipboard);
  // what the DBML editor receives: the enum as DBML, the others as readable comments
  const parsed = toProject(parseDbml(text), "p", text);
  assert.deepEqual(
    parsed.enums.map((e) => [e.name, e.values.map((v) => v.name)]),
    [["status", ["open", "closed"]]],
  );
  assert.ok(text.split("\n").includes("// Zone: Billing"));
  assert.ok(text.split("\n").includes("// Note: check this"));

  const back = parseClipboard(text)!;
  assert.deepEqual({ ...back, refs: [] }, { ...clipboard, refs: [] });

  const taken = { tables: project.tables, enums: project.enums };
  const pasted = instantiateClipboard(back, taken, {}, counter());
  assert.equal(pasted.enums[0].name, "status_copy");
  assert.deepEqual(
    pasted.enums[0].values.map((v) => [v.name, v.note]),
    [
      ["open", undefined],
      ["closed", "done"],
    ],
  );
  assert.deepEqual(pasted.zones[0], {
    id: pasted.zones[0].id,
    label: "Billing",
    position: { x: 44, y: 54 },
    size: { width: 600, height: 400 },
    style: { color: "#00ff00" },
  });
  assert.deepEqual(pasted.stickyNotes[0].position, { x: 724, y: 74 });
  assert.deepEqual(
    pasted.enums[0].position,
    { x: 64, y: 424 },
    "the group keeps its shape: origin is the zone's corner",
  );
  const ids = [
    ...pasted.tables.map((t) => t.id),
    ...pasted.enums.flatMap((e) => [e.id, ...e.values.map((v) => v.id)]),
    pasted.zones[0].id,
    pasted.stickyNotes[0].id,
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("new-")));

  // a second paste into a project that already holds the first: next free enum name
  const again = instantiateClipboard(
    back,
    { tables: project.tables, enums: [...project.enums, ...pasted.enums] },
    { repeat: 1 },
    counter(),
  );
  assert.equal(again.enums[0].name, "status_copy2");
});

test("a relation to a table that was not selected is left out, whatever else is copied", () => {
  const clipboard = copySelection(project, { tableIds: ["o"], enumIds: ["e1"] })!;
  assert.deepEqual(clipboard.refs, []);
  const pasted = instantiateClipboard(clipboard, { tables: [] }, {}, counter());
  assert.equal(pasted.refs.length, 0);
});

test("a clipboard from before enums, zones and notes was copyable still pastes; hostile extras are rebuilt", () => {
  const old = parseClipboard(
    `// nebuladb-clipboard:v1 ${JSON.stringify({ tables: [{ id: "a", name: "a", fields: [{ id: "f", name: "id" }] }], refs: [] })}`,
  )!;
  assert.deepEqual([old.enums, old.zones, old.stickyNotes], [[], [], []]);

  const onlyOthers = parseClipboard(
    `// nebuladb-clipboard:v1 ${JSON.stringify({
      enums: [
        { id: "e", name: "e", values: [{ id: "v", name: "x", note: 5 }, "junk", { name: "no id" }], extra: 1 },
        { id: "e2" },
      ],
      zones: [
        { id: "z", label: 3, position: { x: "a" }, size: { width: 10 }, style: { color: "#fff", x: 1 }, extra: 1 },
        "junk",
      ],
      stickyNotes: [{ id: "n", text: "t".repeat(5000), __proto__: { polluted: 1 } }, {}],
    })}`,
  )!;
  assert.deepEqual(onlyOthers.tables, []);
  assert.deepEqual(onlyOthers.enums, [
    { id: "e", name: "e", values: [{ id: "v", name: "x" }], position: { x: 0, y: 0 } },
  ]);
  assert.deepEqual(onlyOthers.zones, [
    { id: "z", label: "", position: { x: 0, y: 0 }, size: { width: 10, height: 120 }, style: { color: "#fff" } },
  ]);
  assert.equal(onlyOthers.stickyNotes.length, 1);
  assert.equal(onlyOthers.stickyNotes[0].text.length, 2000);
  assert.equal(parseClipboard(`// nebuladb-clipboard:v1 ${JSON.stringify({ zones: [], enums: [{}] })}`), null);

  // instantiating a clipboard without any table must not choke on the empty table list
  const pasted = instantiateClipboard(onlyOthers, { tables: [] }, {}, counter());
  assert.equal(pasted.zones.length, 1);
});
