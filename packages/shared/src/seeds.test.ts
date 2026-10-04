import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Ref, Table } from "./schema.js";
import {
  detectSeparator,
  normalizeSeedValue,
  parseCsv,
  seedColumnValues,
  seedInsertOrder,
  suggestMapping,
  validateSeed,
} from "./seeds.js";

function table(id: string, fields: Partial<Field>[], extra: Partial<Table> = {}): Table {
  return {
    id,
    name: id,
    fields: fields.map((field) => ({ id: `${id}.${field.name}`, type: "text", ...field }) as Field),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
    ...extra,
  };
}

test("parseCsv: quotes, escaped quotes, line breaks in a field, CRLF, BOM; unquoted empty is NULL, quoted empty is ''", () => {
  const text = '﻿id;name;note\r\n1;"Ada; the first";"said ""hi""\nand left"\r\n2;;""\n\n';
  assert.deepEqual(parseCsv(text, ";"), [
    ["id", "name", "note"],
    ["1", "Ada; the first", 'said "hi"\nand left'],
    ["2", null, ""],
  ]);
});

test("detectSeparator and suggestMapping", () => {
  assert.equal(detectSeparator("id;name;email\n1;a;b"), ";");
  assert.equal(detectSeparator("id\tname\n"), "\t");
  assert.equal(detectSeparator("single"), ",");
  const users = table("users", [{ name: "id" }, { name: "email" }, { name: "created_at" }]);
  assert.deepEqual(suggestMapping(["ID", "e-mail", "Created At", "other"], users.fields), [
    "users.id",
    "users.email",
    "users.created_at",
    null,
  ]);
});

test("validateSeed: types, NOT NULL, lengths, duplicates, missing required columns, row width, formulas", () => {
  const users = table("users", [
    { name: "id", type: "integer", pk: true },
    { name: "email", type: "varchar(10)", notNull: true, unique: true },
    { name: "active", type: "boolean" },
    { name: "born", type: "date" },
    { name: "country", type: "char(2)", notNull: true },
  ]);
  const csv = parseCsv(
    [
      "id,email,active,born",
      "1,a@x.io,true,2001-02-03",
      "x,b@x.io,maybe,2001-13-40",
      "1,a@x.io,0,",
      "2,,1,2000-01-01",
      "3,averyveryverylong@x.io,1,2000-01-01",
      "4,=cmd|calc,1,2000-01-01",
      "5,short",
    ].join("\n"),
    ",",
  );
  const { issues } = validateSeed(users, csv, {
    header: true,
    mapping: ["users.id", "users.email", "users.active", "users.born"],
  });
  const summary = issues.map((i) => `${i.kind}:${i.row}:${i.column ?? ""}`);
  assert.deepEqual(summary.sort(), [
    "formula:6:email",
    "length:5:email",
    "missing-column:0:country",
    "not-null:4:email",
    "type:2:active",
    "type:2:born",
    "type:2:id",
    "unique:3:email",
    "unique:3:id",
    "width:7:",
  ]);
  assert.equal(issues.find((i) => i.kind === "formula")?.severity, "warning");
});

test("validateSeed: a CSV column mapped to a column the table no longer has is a warning, not a silence", () => {
  const users = table("users", [{ name: "id", type: "integer", pk: true }, { name: "email" }]);
  const csv = parseCsv(["id,email,phone", "1,a@x.io,0102"].join("\n"), ",");
  const mapping = ["users.id", "users.email", "users.phone"];
  assert.deepEqual(validateSeed(users, csv, { header: true, mapping }), {
    issues: [{ kind: "column-gone", row: 0, value: "phone", severity: "warning" }],
    total: 1,
  });
  // Without a header the file's column is named by its position; an unmapped column is nobody's business.
  assert.deepEqual(validateSeed(users, csv.slice(1), { header: false, mapping }).issues[0].value, "#3");
  assert.equal(validateSeed(users, csv, { header: true, mapping: ["users.id", "users.email", null] }).total, 0);
});

test("validateSeed: a foreign key is checked against the parent table's own seed", () => {
  const customers = table("customers", [{ name: "id", type: "int", pk: true }]);
  const orders = table("orders", [
    { name: "id", type: "int", pk: true },
    { name: "customer_id", type: "int" },
  ]);
  const ref: Ref = {
    id: "r",
    from: { tableId: "orders", fieldId: "orders.customer_id" },
    to: { tableId: "customers", fieldId: "customers.id" },
    cardinality: "one-to-many",
  };
  const parentValues = seedColumnValues(customers, parseCsv("id\n1\n2", ","), {
    header: true,
    mapping: ["customers.id"],
  });
  const { issues } = validateSeed(
    orders,
    parseCsv("id,customer_id\n10,1\n11,3\n12,", ","),
    { header: true, mapping: ["orders.id", "orders.customer_id"] },
    { parentValues, refs: [ref] },
  );
  assert.deepEqual(
    issues.map((i) => `${i.kind}:${i.row}:${i.value}`),
    ["foreign-key:2:3"],
    "a NULL foreign key is fine; 3 has no customer",
  );
});

test("seedInsertOrder: parents first, self-references ignored, cycles reported", () => {
  const ref = (from: string, to: string): Ref => ({
    id: `${from}-${to}`,
    from: { tableId: from, fieldId: `${from}.x` },
    to: { tableId: to, fieldId: `${to}.id` },
    cardinality: "one-to-many",
  });
  assert.deepEqual(
    seedInsertOrder(
      ["lines", "orders", "customers"],
      [ref("lines", "orders"), ref("orders", "customers"), ref("orders", "orders")],
    ),
    { order: ["customers", "orders", "lines"], cycles: [] },
  );
  const { cycles } = seedInsertOrder(["a", "b"], [ref("a", "b"), ref("b", "a")]);
  assert.equal(cycles.length, 1);
  assert.deepEqual([...cycles[0]].sort(), ["a", "b"]);
});

test("normalizeSeedValue spells booleans per engine", () => {
  const flag = { id: "f", name: "flag", type: "boolean" } as Field;
  assert.equal(normalizeSeedValue("oui", flag, "postgres"), "true");
  assert.equal(normalizeSeedValue("no", flag, "mysql"), "0");
  assert.equal(normalizeSeedValue(null, flag, "mysql"), null);
  assert.equal(normalizeSeedValue("yes", { ...flag, type: "text" }, "mysql"), "yes");
});
