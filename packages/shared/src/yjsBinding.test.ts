import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import type { Project } from "./schema.js";
import { writeProjectToDoc, readProjectFromDoc } from "./yjsBinding.js";

function sampleProject(): Project {
  return {
    id: "p1",
    name: "Sample",
    tables: [
      {
        id: "t1",
        name: "users",
        fields: [
          { id: "f1", name: "id", type: "int", pk: true },
          { id: "f2", name: "email", type: "varchar", unique: true },
        ],
        indexes: [{ id: "i1", fieldIds: ["f2"], unique: true }],
        position: { x: 10, y: 20 },
        detailLevel: "standard",
        style: { color: "#123456" },
      },
      {
        id: "t2",
        name: "posts",
        fields: [{ id: "f3", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 300, y: 20 },
        detailLevel: "compact",
      },
    ],
    refs: [
      {
        id: "r1",
        from: { tableId: "t2", fieldId: "f3" },
        to: { tableId: "t1", fieldId: "f1" },
        cardinality: "one-to-many",
      },
    ],
    enums: [{ id: "e1", name: "status", values: [{ id: "v1", name: "active" }], position: { x: 0, y: 400 } }],
    zones: [
      {
        id: "z1",
        label: "Core",
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
        style: { color: "#fbbf24" },
      },
    ],
    stickyNotes: [{ id: "s1", text: "remember this", position: { x: 5, y: 5 }, size: { width: 100, height: 80 } }],
    tableGroups: [],
  };
}

test("writeProjectToDoc -> readProjectFromDoc round-trips a full project", () => {
  const doc = new Y.Doc();
  const project = sampleProject();
  writeProjectToDoc(doc, project);

  const roundTripped = readProjectFromDoc(doc, "fallback-id", "fallback-name");
  assert.equal(roundTripped.id, project.id);
  assert.equal(roundTripped.name, project.name);
  assert.equal(roundTripped.tables.length, 2);
  assert.equal(roundTripped.refs.length, 1);
  assert.equal(roundTripped.enums.length, 1);
  assert.equal(roundTripped.zones.length, 1);
  assert.equal(roundTripped.stickyNotes.length, 1);

  const users = roundTripped.tables.find((t) => t.id === "t1")!;
  assert.deepEqual(users.position, { x: 10, y: 20 });
  assert.equal(users.style?.color, "#123456");
  assert.equal(users.fields.length, 2);
  assert.equal(users.indexes[0].fieldIds[0], "f2");
});

test("writeProjectToDoc fully replaces prior content (entities absent from the new write are removed)", () => {
  const doc = new Y.Doc();
  writeProjectToDoc(doc, sampleProject());

  const trimmed: Project = { ...sampleProject(), tables: [sampleProject().tables[0]], refs: [], zones: [] };
  writeProjectToDoc(doc, trimmed);

  const result = readProjectFromDoc(doc, "fallback-id");
  assert.equal(result.tables.length, 1, "posts table dropped");
  assert.equal(result.refs.length, 0, "ref dropped");
  assert.equal(result.zones.length, 0, "zone dropped");
  assert.equal(result.enums.length, 1, "enum still present (unchanged between writes)");
});

test("survives cross-doc sync via encodeStateAsUpdate/applyUpdate (the actual persistence path)", () => {
  const sourceDoc = new Y.Doc();
  writeProjectToDoc(sourceDoc, sampleProject());

  // Mirrors how apps/server/src/yjs/persistence.ts stores/reconstructs state.
  const update = Y.encodeStateAsUpdate(sourceDoc);
  const restoredDoc = new Y.Doc();
  Y.applyUpdate(restoredDoc, update);

  const restored = readProjectFromDoc(restoredDoc, "fallback-id");
  assert.equal(restored.tables.length, 2);
  assert.equal(restored.tables.find((t) => t.id === "t1")?.name, "users");
  assert.equal(restored.refs[0].from.tableId, "t2");
});

test("paletteColors round-trips through meta, and stays unset (not defaulted) when the project never customized one", () => {
  const doc = new Y.Doc();
  writeProjectToDoc(doc, sampleProject());
  const withoutPalette = readProjectFromDoc(doc, "fallback-id");
  assert.equal(
    withoutPalette.paletteColors,
    undefined,
    "callers fall back to a default palette themselves, not this layer",
  );

  writeProjectToDoc(doc, { ...sampleProject(), paletteColors: ["#111111", "#222222"] });
  const withPalette = readProjectFromDoc(doc, "fallback-id");
  assert.deepEqual(withPalette.paletteColors, ["#111111", "#222222"]);
});

test("readProjectFromDoc uses fallback id/name only when meta hasn't been set", () => {
  const doc = new Y.Doc();
  const empty = readProjectFromDoc(doc, "fallback-id", "fallback-name");
  assert.equal(empty.id, "fallback-id");
  assert.equal(empty.name, "fallback-name");
  assert.equal(empty.tables.length, 0);

  writeProjectToDoc(doc, sampleProject());
  const populated = readProjectFromDoc(doc, "fallback-id", "fallback-name");
  assert.equal(populated.id, "p1", "meta id wins over fallback once set");
  assert.equal(populated.name, "Sample");
});
