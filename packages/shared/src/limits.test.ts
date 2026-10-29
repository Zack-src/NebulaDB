import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnumDef, Table, TableGroup } from "./schema.js";
import {
  COLLECTION_COUNT_LIMITS,
  MAX_COMMENTS_PER_TABLE,
  MAX_FIELDS_PER_TABLE,
  MAX_INDEXES_PER_TABLE,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PALETTE_COLORS,
  MAX_TABLES_PER_TABLE_GROUP,
  MAX_TEXT_LENGTH,
  MAX_VALUES_PER_ENUM,
  clampCollectionValue,
  clampEnum,
  clampMetaValue,
  clampStickyNote,
  clampTable,
  clampTableGroup,
} from "./limits.js";
import { REFS_KEY, STICKY_NOTES_KEY, TABLE_GROUPS_KEY, TABLES_KEY } from "./yjsBinding.js";

function sampleTable(overrides: Partial<Table> = {}): Table {
  return {
    id: "t1",
    name: "users",
    fields: [{ id: "f1", name: "id", type: "int", pk: true }],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
    ...overrides,
  };
}

test("clampTable returns null when everything is within limits", () => {
  assert.equal(clampTable(sampleTable()), null);
});

test("clampTable truncates an over-long table name", () => {
  const clamped = clampTable(sampleTable({ name: "a".repeat(MAX_NAME_LENGTH + 500) }));
  assert.ok(clamped);
  assert.equal(clamped.name.length, MAX_NAME_LENGTH);
  assert.equal(clamped.id, "t1");
});

test("clampTable truncates nested field, index, comment and note strings", () => {
  const clamped = clampTable(
    sampleTable({
      note: "n".repeat(MAX_NOTE_LENGTH + 1),
      fields: [
        {
          id: "f1",
          name: "x".repeat(MAX_NAME_LENGTH + 1),
          type: "y".repeat(MAX_NAME_LENGTH + 1),
          default: "d".repeat(5000),
          note: "z".repeat(MAX_NOTE_LENGTH + 1),
        },
      ],
      indexes: [{ id: "i1", fieldIds: ["f1"], name: "i".repeat(MAX_NAME_LENGTH + 1) }],
      comments: [
        {
          id: "c1",
          author: "u".repeat(500),
          text: "t".repeat(MAX_TEXT_LENGTH + 1),
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  assert.ok(clamped);
  assert.equal(clamped.note?.length, MAX_NOTE_LENGTH);
  assert.equal(clamped.fields[0]!.name.length, MAX_NAME_LENGTH);
  assert.equal(clamped.fields[0]!.type.length, MAX_NAME_LENGTH);
  assert.equal(clamped.fields[0]!.default?.length, 500);
  assert.equal(clamped.fields[0]!.note?.length, MAX_NOTE_LENGTH);
  assert.equal(clamped.indexes[0]!.name?.length, MAX_NAME_LENGTH);
  assert.equal(clamped.comments?.[0]!.text.length, MAX_TEXT_LENGTH);
  assert.equal(clamped.comments?.[0].author.length, 100);
});

test("clampTable survives a hostile entity whose arrays are not arrays", () => {
  const hostile = { ...sampleTable(), fields: "nope", indexes: null, style: 7 } as unknown as Table;
  assert.equal(clampTable(hostile), null);

  const hostileAndLong = { ...hostile, name: "a".repeat(MAX_NAME_LENGTH + 1) } as unknown as Table;
  const clamped = clampTable(hostileAndLong);
  assert.ok(clamped);
  assert.equal(clamped.name.length, MAX_NAME_LENGTH);
  assert.equal(clamped.fields as unknown, "nope");
});

test("clampStickyNote truncates text and style colors", () => {
  const clamped = clampStickyNote({
    id: "s1",
    text: "t".repeat(MAX_TEXT_LENGTH + 1),
    position: { x: 0, y: 0 },
    size: { width: 10, height: 10 },
    style: { color: "#".repeat(500) },
  });
  assert.ok(clamped);
  assert.equal(clamped.text.length, MAX_TEXT_LENGTH);
  assert.equal(clamped.style?.color?.length, 64);
});

test("clampCollectionValue dispatches by collection key and ignores non-entities", () => {
  const table = clampCollectionValue(TABLES_KEY, sampleTable({ name: "a".repeat(MAX_NAME_LENGTH + 1) })) as Table;
  assert.equal(table.name.length, MAX_NAME_LENGTH);
  assert.equal(clampCollectionValue(STICKY_NOTES_KEY, "not an object"), null);
  assert.equal(clampCollectionValue("unknownCollection", sampleTable()), null);
});

test("clampTable caps the number of fields, indexes and comments a table can carry", () => {
  const fields = Array.from({ length: MAX_FIELDS_PER_TABLE + 10 }, (_, i) => ({
    id: `f${i}`,
    name: `col${i}`,
    type: "int",
  }));
  const indexes = Array.from({ length: MAX_INDEXES_PER_TABLE + 5 }, (_, i) => ({ id: `i${i}`, fieldIds: ["f0"] }));
  const comments = Array.from({ length: MAX_COMMENTS_PER_TABLE + 5 }, (_, i) => ({
    id: `c${i}`,
    author: "u",
    text: "hi",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  const clamped = clampTable(sampleTable({ fields, indexes, comments }));
  assert.ok(clamped);
  assert.equal(clamped.fields.length, MAX_FIELDS_PER_TABLE);
  assert.equal(clamped.indexes.length, MAX_INDEXES_PER_TABLE);
  assert.equal(clamped.comments?.length, MAX_COMMENTS_PER_TABLE);
});

test("clampEnum caps the number of values", () => {
  const enumDef: EnumDef = {
    id: "e1",
    name: "status",
    position: { x: 0, y: 0 },
    values: Array.from({ length: MAX_VALUES_PER_ENUM + 10 }, (_, i) => ({ id: `v${i}`, name: `v${i}` })),
  };
  const clamped = clampEnum(enumDef);
  assert.ok(clamped);
  assert.equal(clamped.values.length, MAX_VALUES_PER_ENUM);
});

test("clampTableGroup truncates the name and caps membership count", () => {
  const group: TableGroup = {
    id: "g1",
    name: "a".repeat(MAX_NAME_LENGTH + 1),
    tableIds: Array.from({ length: MAX_TABLES_PER_TABLE_GROUP + 5 }, (_, i) => `t${i}`),
  };
  const clamped = clampTableGroup(group);
  assert.ok(clamped);
  assert.equal(clamped.name.length, MAX_NAME_LENGTH);
  assert.equal(clamped.tableIds.length, MAX_TABLES_PER_TABLE_GROUP);

  assert.equal(clampTableGroup({ id: "g2", name: "fine", tableIds: ["t1", "t2"] }), null);
});

test("clampCollectionValue dispatches TableGroup too", () => {
  const dispatched = clampCollectionValue(TABLE_GROUPS_KEY, {
    id: "g1",
    name: "a".repeat(MAX_NAME_LENGTH + 1),
    tableIds: [],
  }) as TableGroup;
  assert.equal(dispatched.name.length, MAX_NAME_LENGTH);
});

test("COLLECTION_COUNT_LIMITS covers every collection that has one, and nothing else", () => {
  assert.equal(typeof COLLECTION_COUNT_LIMITS[TABLES_KEY], "number");
  assert.equal(typeof COLLECTION_COUNT_LIMITS[REFS_KEY], "number");
  assert.equal(typeof COLLECTION_COUNT_LIMITS[TABLE_GROUPS_KEY], "number");
  assert.equal(COLLECTION_COUNT_LIMITS.meta, undefined, "meta is a flat scalar map, not an entity collection");
});

test("clampMetaValue caps the project name and the palette", () => {
  assert.equal(clampMetaValue("name", "ok"), null);
  assert.equal((clampMetaValue("name", "a".repeat(MAX_NAME_LENGTH + 1)) as string).length, MAX_NAME_LENGTH);

  const palette = Array.from({ length: MAX_PALETTE_COLORS + 10 }, () => "#000000");
  assert.equal((clampMetaValue("paletteColors", palette) as string[]).length, MAX_PALETTE_COLORS);
  assert.equal(clampMetaValue("paletteColors", ["#000000"]), null);
  assert.equal((clampMetaValue("paletteColors", ["#".repeat(200)]) as string[])[0]!.length, 64);

  assert.equal(clampMetaValue("id", "p1"), null);
});
