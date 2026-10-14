import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Table } from "@nebuladb/shared";
import { addSuggestedIndex } from "./lint.js";
import { generateCreateIndex } from "./migrationGenerator.js";

function field(id: string, name: string, extra: Partial<Field> = {}): Field {
  return { id, name, type: "integer", ...extra };
}

function table(id: string, name: string, fields: Field[], extra: Partial<Table> = {}): Table {
  return { id, name, fields, indexes: [], position: { x: 0, y: 0 }, detailLevel: "standard", ...extra };
}

function project(tables: Table[]): Project {
  return { id: "p1", name: "Test", tables, refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

test("addSuggestedIndex adds a plain index like the foreign-key fix, once, and only on what the schema has", () => {
  const orders = table("o", "orders", [
    field("o-id", "id", { pk: true }),
    field("o-c", "customer_id"),
    field("o-s", "status"),
  ]);
  const p = project([orders]);
  let n = 0;
  const newId = () => `idx-${++n}`;

  const fixed = addSuggestedIndex(p, "Orders", ["customer_id", "STATUS"], newId)!;
  assert.deepEqual(fixed.tables[0].indexes, [{ id: "idx-1", fieldIds: ["o-c", "o-s"] }]);
  assert.equal(p.tables[0].indexes.length, 0);
  // An index that already starts with the columns, the key, an unknown table or column: nothing to do.
  assert.equal(addSuggestedIndex(fixed, "orders", ["customer_id"], newId), null);
  assert.equal(addSuggestedIndex(fixed, "orders", ["customer_id", "status"], newId), null);
  assert.equal(addSuggestedIndex(p, "orders", ["id"], newId), null);
  assert.equal(addSuggestedIndex(p, "ghosts", ["id"], newId), null);
  assert.equal(addSuggestedIndex(p, "orders", ["nope"], newId), null);
  assert.equal(addSuggestedIndex(p, "orders", [], newId), null);
  // The same name in two schemas is told apart by the schema.
  const twin = project([
    { ...orders, schemaName: "a" },
    { ...orders, id: "o2", schemaName: "b" },
  ]);
  assert.equal(addSuggestedIndex(twin, "orders", ["status"], newId), null);
  assert.equal(addSuggestedIndex(twin, "orders", ["status"], newId, "b")!.tables[1].indexes.length, 1);
});

test("generateCreateIndex: each dialect's quoting and IF NOT EXISTS, schema-qualified on request", () => {
  const sql = (
    dialect: Parameters<typeof generateCreateIndex>[3],
    options?: Parameters<typeof generateCreateIndex>[4],
  ) => generateCreateIndex("orders", ["customer_id", "status"], "idx_orders_customer_id_status", dialect, options);
  assert.equal(
    sql("postgres"),
    'CREATE INDEX IF NOT EXISTS "idx_orders_customer_id_status" ON "orders" ("customer_id", "status");',
  );
  assert.equal(
    sql("postgres", { schema: "shop", unique: true }),
    'CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_customer_id_status" ON "shop"."orders" ("customer_id", "status");',
  );
  assert.equal(
    sql("mysql"),
    "CREATE INDEX IF NOT EXISTS `idx_orders_customer_id_status` ON `orders` (`customer_id`, `status`);",
  );
  assert.equal(sql("mssql"), "CREATE INDEX [idx_orders_customer_id_status] ON [orders] ([customer_id], [status]);");
  assert.equal(sql("oracle"), 'CREATE INDEX "idx_orders_customer_id_status" ON "orders" ("customer_id", "status");');
  assert.match(sql("bigquery"), /^-- BigQuery has no secondary indexes/);
});
