import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {
  getEnumsMap,
  getRefsMap,
  getStickyNotesMap,
  getTablesMap,
  getZonesMap,
  readProjectFromDoc,
  writeProjectToDoc,
  type DetailLevel,
  type Project,
  type Table,
} from "@nebuladb/shared";
import { activeDetailLevelOf, createProjectMutations } from "@/features/editor/hooks/projectMutations";
import type { CanvasNode } from "@/features/editor/nodes/nodeTypes";

const table = (id: string, over: Partial<Table> = {}): Table => ({
  id,
  name: id,
  fields: [
    { id: `${id}.id`, name: "id", type: "integer", pk: true },
    { id: `${id}.ref`, name: "ref", type: "integer" },
  ],
  indexes: [],
  position: { x: 10, y: 20 },
  detailLevel: "standard",
  ...over,
});

const emptyProject = (tables: Table[] = []): Project => ({
  id: "p",
  name: "P",
  tables,
  refs: [],
  enums: [],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
});

function setup(project: Project, selected: CanvasNode[] = []) {
  const doc = new Y.Doc();
  writeProjectToDoc(doc, project);
  const mutations = createProjectMutations(
    () => readProjectFromDoc(doc, "p", "P"),
    () => doc,
    () => selected,
  );
  const tables = () => [...getTablesMap(doc).values()];
  return { doc, mutations, tables };
}

const sel = (type: string, id: string, data: Record<string, unknown>) =>
  ({ id, type, selected: true, data }) as unknown as CanvasNode;

describe("read-only grant (no doc)", () => {
  test("every mutator is a no-op", () => {
    const m = createProjectMutations(
      () => emptyProject([table("a")]),
      () => null,
      () => [sel("table", "a", { table: table("a") })],
    );
    assert.doesNotThrow(() => {
      m.addTable();
      m.addZone();
      m.addStickyNote();
      m.addEnum();
      m.setAllDetailLevels("full");
      m.setTablesColor(["a"], "#fff");
      m.convertFieldTypes([{ tableId: "a", fieldId: "a.id", newType: "bigint" }]);
      m.duplicateSelected();
      m.deleteEdges(["r"]);
      m.onConnect({ source: "a", target: "b", sourceHandle: "x-right-source", targetHandle: "y-left-target" });
    });
    assert.equal(m.pasteElements({ tables: [], refs: [], enums: [], zones: [], stickyNotes: [] }, {}), 0);
  });
});

describe("adding elements", () => {
  test("addTable seeds an id column, numbers the name and lays out on a 6-wide grid", () => {
    const { mutations, tables } = setup(emptyProject());
    for (let i = 0; i < 8; i++) mutations.addTable();
    const all = tables();
    assert.equal(all[0].name, "table_1");
    assert.deepEqual(all[0].position, { x: 0, y: 0 });
    assert.deepEqual(all[5].position, { x: 5 * 260, y: 0 });
    assert.deepEqual(all[6].position, { x: 0, y: 200 });
    assert.equal(all[0].fields.length, 1);
    assert.deepEqual([all[0].fields[0].name, all[0].fields[0].pk, all[0].fields[0].increment], ["id", true, true]);
    assert.equal(new Set(all.map((t) => t.id)).size, 8);
  });

  test("addTable at a position uses it", () => {
    const { mutations, tables } = setup(emptyProject());
    mutations.addTable({ x: 7, y: 9 });
    assert.deepEqual(tables()[0].position, { x: 7, y: 9 });
  });

  test("a new table follows the project's uniform detail level, else 'standard'", () => {
    const uniform = setup(emptyProject([table("a", { detailLevel: "full" }), table("b", { detailLevel: "full" })]));
    uniform.mutations.addTable();
    assert.equal(uniform.tables().at(-1)!.detailLevel, "full");
    const mixed = setup(emptyProject([table("a", { detailLevel: "full" }), table("b", { detailLevel: "compact" })]));
    mixed.mutations.addTable();
    assert.equal(mixed.tables().at(-1)!.detailLevel, "standard");
  });

  test("zones, notes and enums get their defaults", () => {
    const { doc, mutations } = setup(emptyProject());
    mutations.addZone();
    mutations.addStickyNote({ x: 1, y: 2 });
    mutations.addEnum();
    mutations.addEnum();
    const [zone] = [...getZonesMap(doc).values()];
    assert.deepEqual([zone.label, zone.size, zone.position], ["Zone", { width: 300, height: 220 }, { x: 40, y: 40 }]);
    const [note] = [...getStickyNotesMap(doc).values()];
    assert.deepEqual([note.text, note.position], ["", { x: 1, y: 2 }]);
    assert.deepEqual(
      [...getEnumsMap(doc).values()].map((e) => e.name),
      ["enum_1", "enum_2"],
    );
    assert.equal([...getEnumsMap(doc).values()][0].values.length, 1);
  });
});

describe("bulk changes", () => {
  test("setAllDetailLevels changes every table in a single Yjs transaction", () => {
    const { doc, mutations, tables } = setup(emptyProject([table("a"), table("b"), table("c")]));
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    mutations.setAllDetailLevels("compact");
    assert.equal(transactions, 1);
    assert.deepEqual(new Set(tables().map((t) => t.detailLevel)), new Set<DetailLevel>(["compact"]));
  });

  test("setTablesColor colours only the listed existing tables and keeps other style keys", () => {
    const { mutations, tables } = setup(emptyProject([table("a"), table("b", { style: { color: "#000" } as never })]));
    mutations.setTablesColor(["b", "ghost"], "#f00");
    const byId = Object.fromEntries(tables().map((t) => [t.id, t]));
    assert.equal(byId.b.style?.color, "#f00");
    assert.equal(byId.a.style?.color, undefined);
    assert.equal(tables().length, 2, "an unknown id creates nothing");
  });

  test("setTablesColor with no ids does nothing", () => {
    const { doc, mutations } = setup(emptyProject([table("a")]));
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    mutations.setTablesColor([], "#f00");
    assert.equal(transactions, 0);
  });

  test("convertFieldTypes rewrites just the targeted fields and skips unknown tables", () => {
    const { mutations, tables } = setup(emptyProject([table("a"), table("b")]));
    mutations.convertFieldTypes([
      { tableId: "a", fieldId: "a.id", newType: "bigint" },
      { tableId: "ghost", fieldId: "x", newType: "text" },
    ]);
    const a = tables().find((t) => t.id === "a")!;
    assert.deepEqual(
      a.fields.map((f) => f.type),
      ["bigint", "integer"],
    );
    assert.deepEqual(
      tables()
        .find((t) => t.id === "b")!
        .fields.map((f) => f.type),
      ["integer", "integer"],
    );
  });

  test("convertFieldTypes with no changes opens no transaction", () => {
    const { doc, mutations } = setup(emptyProject([table("a")]));
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    mutations.convertFieldTypes([]);
    assert.equal(transactions, 0);
  });
});

describe("activeDetailLevelOf", () => {
  test("null for no project or no table", () => {
    assert.equal(activeDetailLevelOf(null), null);
    assert.equal(activeDetailLevelOf(emptyProject()), null);
  });

  test("the shared level when every table has it, null once they diverge", () => {
    assert.equal(activeDetailLevelOf(emptyProject([table("a", { detailLevel: "full" })])), "full");
    assert.equal(
      activeDetailLevelOf(emptyProject([table("a", { detailLevel: "full" }), table("b", { detailLevel: "full" })])),
      "full",
    );
    assert.equal(
      activeDetailLevelOf(emptyProject([table("a", { detailLevel: "full" }), table("b", { detailLevel: "compact" })])),
      null,
    );
  });
});

describe("duplicateSelected", () => {
  test("does nothing when nothing is selected", () => {
    const a = table("a");
    const { doc, mutations, tables } = setup(emptyProject([a]), [
      { ...sel("table", "a", { table: a }), selected: false } as CanvasNode,
    ]);
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    mutations.duplicateSelected();
    assert.equal(transactions, 0);
    assert.equal(tables().length, 1);
  });

  test("a table copy gets new ids, an offset, a free name and remapped index fields", () => {
    const a = table("a", {
      detailLevel: "full",
      indexes: [{ id: "i1", name: "ix", fieldIds: ["a.ref", "foreign"] } as never],
    });
    const { mutations, tables } = setup(emptyProject([a]), [
      // The rendered node says "compact"; the doc row, "full", is what must be copied.
      sel("table", "a", { table: { ...a, detailLevel: "compact" } }),
    ]);
    mutations.duplicateSelected();
    const copy = tables().find((t) => t.id !== "a")!;
    assert.equal(copy.name, "a_copy");
    assert.deepEqual(copy.position, { x: 34, y: 44 });
    assert.equal(copy.detailLevel, "full");
    assert.ok(
      copy.fields.every((f) => !a.fields.some((o) => o.id === f.id)),
      "field ids are fresh",
    );
    assert.equal(copy.indexes[0].id !== "i1", true);
    assert.equal(copy.indexes[0].fieldIds[0], copy.fields[1].id, "index follows the copied field");
    assert.equal(copy.indexes[0].fieldIds[1], "foreign", "an id not in the table is left alone");
  });

  test("duplicating a table and its copy together never yields the same name twice", () => {
    const a = table("a", { name: "users" });
    const aCopy = table("a2", { name: "users_copy" });
    const { mutations, tables } = setup(emptyProject([a, aCopy]), [
      sel("table", "a", { table: a }),
      sel("table", "a2", { table: aCopy }),
    ]);
    mutations.duplicateSelected();
    const names = tables().map((t) => t.name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.length, 4);
  });

  test("zones, notes and enums are copied with the offset; enums get _copy and fresh value ids", () => {
    const zone = {
      id: "z",
      label: "Z",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
      style: { color: "#fff" },
    };
    const note = {
      id: "n",
      text: "hi",
      position: { x: 5, y: 5 },
      size: { width: 1, height: 1 },
      style: { color: "#fff" },
    };
    const enumDef = { id: "e", name: "status", values: [{ id: "v1", name: "on" }], position: { x: 1, y: 1 } };
    const { doc, mutations } = setup(emptyProject(), []);
    getZonesMap(doc).set("z", zone as never);
    getStickyNotesMap(doc).set("n", note as never);
    getEnumsMap(doc).set("e", enumDef as never);
    const m = createProjectMutations(
      () => readProjectFromDoc(doc, "p", "P"),
      () => doc,
      () => [sel("zone", "z", { zone }), sel("sticky", "n", { note }), sel("enum", "e", { enumDef })],
    );
    void mutations;
    m.duplicateSelected();
    const zoneCopy = [...getZonesMap(doc).values()].find((x) => x.id !== "z")!;
    const noteCopy = [...getStickyNotesMap(doc).values()].find((x) => x.id !== "n")!;
    const enumCopy = [...getEnumsMap(doc).values()].find((x) => x.id !== "e")!;
    assert.deepEqual(zoneCopy.position, { x: 24, y: 24 });
    assert.deepEqual([noteCopy.position, noteCopy.text], [{ x: 29, y: 29 }, "hi"]);
    assert.equal(enumCopy.name, "status_copy");
    assert.notEqual(enumCopy.values[0].id, "v1");
    assert.equal(enumCopy.values[0].name, "on");
  });

  test("an unselected or unknown node type is ignored", () => {
    const { doc, mutations, tables } = setup(emptyProject([table("a")]), [sel("group", "g", {})]);
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    mutations.duplicateSelected();
    assert.equal(tables().length, 1);
  });
});

describe("onConnect", () => {
  const two = () => setup(emptyProject([table("a"), table("b")]));
  const handle = (field: string, side: "source" | "target") =>
    `${field}-${side === "source" ? "right" : "left"}-${side}`;

  test("ignores a connection with a missing end or handle", () => {
    const { doc, mutations } = two();
    mutations.onConnect({
      source: "a",
      target: "",
      sourceHandle: "a.ref-right-source",
      targetHandle: "b.id-left-target",
    });
    mutations.onConnect({ source: "a", target: "b", sourceHandle: null, targetHandle: "b.id-left-target" });
    mutations.onConnect({ source: "a", target: "b", sourceHandle: "a.ref-right-source", targetHandle: null });
    assert.equal(getRefsMap(doc).size, 0);
  });

  test("a field cannot reference itself, but another field of the same table can", () => {
    const { doc, mutations } = two();
    mutations.onConnect({
      source: "a",
      target: "a",
      sourceHandle: handle("a.ref", "source"),
      targetHandle: handle("a.ref", "target"),
    });
    assert.equal(getRefsMap(doc).size, 0);
    mutations.onConnect({
      source: "a",
      target: "a",
      sourceHandle: handle("a.ref", "source"),
      targetHandle: handle("a.id", "target"),
    });
    assert.equal(getRefsMap(doc).size, 1);
  });

  test("an unknown table or field handle draws nothing", () => {
    const { doc, mutations } = two();
    mutations.onConnect({
      source: "ghost",
      target: "b",
      sourceHandle: handle("x", "source"),
      targetHandle: handle("b.id", "target"),
    });
    assert.equal(getRefsMap(doc).size, 0);
  });

  test("the header handle resolves to the primary key, else the first field", () => {
    const noPk = table("n", {
      fields: [
        { id: "n.first", name: "first", type: "text" },
        { id: "n.second", name: "second", type: "text" },
      ],
    });
    const { doc, mutations } = setup(emptyProject([table("a"), noPk]));
    mutations.onConnect({
      source: "a",
      target: "n",
      sourceHandle: "header-right-source",
      targetHandle: "header-left-target",
    });
    const ref = [...getRefsMap(doc).values()][0];
    // a's header is its pk (a.id), n's is its first field; key -> plain is stored reversed.
    assert.equal(ref.from.fieldId, "n.first");
    assert.equal(ref.to.fieldId, "a.id");
    assert.equal(ref.cardinality, "one-to-many");
  });

  test("dragging from a key to a plain column stores the foreign key on the plain side", () => {
    const { doc, mutations } = two();
    // b.id (pk) -> a.ref (plain): the ref belongs to a.
    mutations.onConnect({
      source: "b",
      target: "a",
      sourceHandle: handle("b.id", "source"),
      targetHandle: handle("a.ref", "target"),
    });
    const ref = [...getRefsMap(doc).values()][0];
    assert.deepEqual([ref.from.tableId, ref.from.fieldId, ref.to.tableId], ["a", "a.ref", "b"]);
  });

  test("dragging from the plain column to the key keeps the direction", () => {
    const { doc, mutations } = two();
    mutations.onConnect({
      source: "a",
      target: "b",
      sourceHandle: handle("a.ref", "source"),
      targetHandle: handle("b.id", "target"),
    });
    const ref = [...getRefsMap(doc).values()][0];
    assert.deepEqual([ref.from.tableId, ref.to.tableId], ["a", "b"]);
  });
});

describe("deleteEdges", () => {
  test("ignores unknown ids and deletes known ones in one transaction", () => {
    const project = emptyProject([table("a"), table("b")]);
    project.refs = ["r1", "r2"].map((id) => ({
      id,
      from: { tableId: "a", fieldId: "a.ref" },
      to: { tableId: "b", fieldId: "b.id" },
      cardinality: "one-to-many" as const,
    }));
    const { doc, mutations } = setup(project);
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    mutations.deleteEdges(["r1", "r2", "ghost"]);
    assert.equal(getRefsMap(doc).size, 0);
    assert.equal(transactions, 1);
  });

  test("reports a locked table by its id when the project has no such name", () => {
    const project = emptyProject([table("a"), table("b")]);
    project.refs = [
      {
        id: "r1",
        from: { tableId: "a", fieldId: "a.ref" },
        to: { tableId: "b", fieldId: "b.id" },
        cardinality: "one-to-many",
      },
    ];
    const doc = new Y.Doc();
    writeProjectToDoc(doc, project);
    const refused: string[] = [];
    const m = createProjectMutations(
      () => null, // project not loaded: the lock message falls back to the id
      () => doc,
      () => [],
      { frozenTableIds: () => new Set(["a"]), onLockedRelation: (n) => refused.push(n) },
    );
    m.deleteEdges(["r1"]);
    assert.deepEqual(refused, ["a"]);
    assert.equal(getRefsMap(doc).size, 1);
  });
});

describe("pasteElements", () => {
  test("adds copies next to the originals and returns how many landed", () => {
    const a = table("a", { name: "users" });
    const { mutations, tables } = setup(emptyProject([a]));
    const landed = mutations.pasteElements({ tables: [a], refs: [], enums: [], zones: [], stickyNotes: [] }, {});
    assert.equal(landed, 1);
    const names = tables()
      .map((t) => t.name)
      .sort();
    assert.equal(names.length, 2);
    assert.equal(names[1], "users_copy");
  });

  test("pasting the same clipboard twice does not collide on names", () => {
    const a = table("a", { name: "users" });
    const { mutations, tables } = setup(emptyProject([a]));
    const clip = { tables: [a], refs: [], enums: [], zones: [], stickyNotes: [] };
    mutations.pasteElements(clip, {});
    mutations.pasteElements(clip, { repeat: 1 });
    const names = tables().map((t) => t.name.toLowerCase());
    assert.equal(new Set(names).size, 3);
  });
});
