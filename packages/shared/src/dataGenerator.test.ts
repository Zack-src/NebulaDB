import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Ref, Table } from "./schema.js";
import { generateRows, suggestGenerator, toCsv } from "./dataGenerator.js";
import { parseCsv, seedColumnValues, validateSeed } from "./seeds.js";

function table(id: string, fields: Partial<Field>[]): Table {
  return {
    id,
    name: id,
    fields: fields.map((field) => ({ id: `${id}.${field.name}`, type: "text", ...field }) as Field),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

const customers = table("customers", [
  { name: "id", type: "integer", pk: true },
  { name: "email", type: "varchar(40)", notNull: true, unique: true },
  { name: "first_name", type: "varchar(30)" },
  { name: "city", type: "varchar(4)" },
  { name: "active", type: "boolean", notNull: true },
  { name: "joined", type: "date" },
  { name: "balance", type: "numeric(10,2)" },
  { name: "tier", type: "varchar(10)", notNull: true },
]);

const orders = table("orders", [
  { name: "id", type: "serial", pk: true, increment: true },
  { name: "customer_id", type: "integer", notNull: true },
  { name: "note", type: "text" },
]);

const ref: Ref = {
  id: "r",
  from: { tableId: "orders", fieldId: "orders.customer_id" },
  to: { tableId: "customers", fieldId: "customers.id" },
  cardinality: "one-to-many",
};

const config = (rows: number, seed: number, columns: Record<string, unknown> = {}) => ({
  rows,
  seed,
  locale: "fr" as const,
  columns: columns as Record<string, { kind: "oneOf"; values: string[]; weights: number[] }>,
});

test("suggestGenerator reads the column's name, type and relations", () => {
  const kind = (t: Table, name: string, refs: Ref[] = []) =>
    suggestGenerator(
      t.fields.find((f) => f.name === name)!,
      t,
      refs,
    ).kind;
  assert.equal(kind(customers, "id"), "sequence");
  assert.equal(kind(customers, "email"), "email");
  assert.equal(kind(customers, "first_name"), "firstName");
  assert.equal(kind(customers, "city"), "city");
  assert.equal(kind(customers, "active"), "boolean");
  assert.equal(kind(customers, "joined"), "date");
  assert.equal(kind(customers, "balance"), "decimal");
  assert.equal(kind(orders, "id"), "auto");
  assert.equal(kind(orders, "customer_id", [ref]), "foreignKey");
  assert.equal(kind(orders, "note"), "sentence");
});

test("same seed, same rows; another seed, other rows", () => {
  const a = generateRows(customers, config(20, 42));
  const b = generateRows(customers, config(20, 42));
  const c = generateRows(customers, config(20, 43));
  assert.deepEqual(a.rows, b.rows);
  assert.notDeepEqual(a.rows, c.rows);
});

test("generated rows pass the seed checks: types, NOT NULL, lengths, unique, foreign keys, weighted choices", () => {
  const parent = generateRows(
    customers,
    config(300, 7, { "customers.tier": { kind: "oneOf", values: ["gold", "silver"], weights: [1, 9] } }),
  );
  assert.deepEqual(parent.problems, []);
  const parentCsv = parseCsv(
    toCsv(
      parent.columns.map((f) => f.name),
      parent.rows,
    ),
    ",",
  );
  const parentOptions = { header: true, mapping: parent.columns.map((f) => f.id) };
  assert.deepEqual(validateSeed(customers, parentCsv, parentOptions).issues, []);
  const gold = parent.rows.filter((row) => row[7] === "gold").length;
  assert.ok(gold > 5 && gold < 70, `weights are followed (${gold} gold out of 300)`);
  assert.ok(
    parent.rows.every((row) => row[3] === null || [...row[3]].length <= 4),
    "cut to varchar(4)",
  );

  const parentValues = seedColumnValues(customers, parentCsv, parentOptions);
  const child = generateRows(orders, config(50, 7), { parentValues, refs: [ref] });
  assert.deepEqual(
    child.columns.map((f) => f.name),
    ["customer_id", "note"],
    "the auto-increment is left to the database",
  );
  const childCsv = parseCsv(
    toCsv(
      child.columns.map((f) => f.name),
      child.rows,
    ),
    ",",
  );
  assert.deepEqual(
    validateSeed(
      orders,
      childCsv,
      { header: true, mapping: child.columns.map((f) => f.id) },
      { parentValues, refs: [ref] },
    ).issues,
    [],
  );
});

test("a NOT NULL foreign key with no parent rows is reported, not filled with nonsense", () => {
  const { problems } = generateRows(orders, config(5, 1), { refs: [ref] });
  assert.deepEqual(problems, [{ column: "customer_id", reason: "no-parent-values" }]);
});

test("toCsv quotes what needs quoting and keeps NULL apart from the empty string", () => {
  assert.equal(
    toCsv(
      ["a", "b"],
      [
        ["x,y", null],
        ['say "hi"', ""],
      ],
    ),
    'a,b\n"x,y",\n"say ""hi""",""\n',
  );
});
