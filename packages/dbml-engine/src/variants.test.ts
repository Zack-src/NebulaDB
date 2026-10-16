import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Ref, Table } from "@nebuladb/shared";
import { applyVariantSync, planVariantSync, replaceVariantSchema, variantStatus } from "./variants.js";

const field = (table: string, name: string, type = "int", extra: Partial<Field> = {}): Field => ({
  id: `${table}.${name}`,
  name,
  type,
  ...extra,
});

function table(id: string, fields: Field[], extra: Partial<Table> = {}): Table {
  return { id, name: id, fields, indexes: [], position: { x: 0, y: 0 }, detailLevel: "standard", ...extra };
}

const ref = (id: string, from: string, to: string): Ref => ({
  id,
  from: { tableId: from.split(".")[0], fieldId: from },
  to: { tableId: to.split(".")[0], fieldId: to },
  cardinality: "one-to-many",
});

function project(tables: Table[], refs: Ref[] = [], extra: Partial<Project> = {}): Project {
  return { id: "p", name: "P", tables, refs, enums: [], zones: [], stickyNotes: [], tableGroups: [], ...extra };
}

const clone = <T>(value: T): T => structuredClone(value);

// The original as the client last received it: customers and orders.
const synced = project(
  [
    table("customers", [field("customers", "id"), field("customers", "name", "text")]),
    table("orders", [field("orders", "id"), field("orders", "customer_id"), field("orders", "total", "numeric")]),
  ],
  [ref("r1", "orders.customer_id", "customers.id")],
);

test("nothing changed on either side: nothing to send", () => {
  assert.deepEqual(planVariantSync(synced, clone(synced), clone(synced)).changes, []);
  assert.deepEqual(variantStatus(synced, synced, synced), { pending: 0, conflicts: 0, customizations: 0 });
});

test("the original's additions, changes and removals reach a variant the client never touched", () => {
  const base = clone(synced);
  base.tables[0].fields.push(field("customers", "email", "text", { unique: true }));
  base.tables[1].fields[2] = field("orders", "total", "decimal(12,2)");
  base.tables[1].name = "purchases";
  base.tables.push(table("invoices", [field("invoices", "id"), field("invoices", "order_id")]));
  base.refs.push(ref("r2", "invoices.order_id", "orders.id"));
  base.tables[0].fields = base.tables[0].fields.filter((f) => f.name !== "name");

  const variant = clone(synced);
  // The client's own layout is never touched.
  variant.tables[0].position = { x: 500, y: 300 };

  const plan = planVariantSync(synced, base, variant);
  assert.deepEqual(
    plan.changes.map((c) => `${c.action} ${c.kind} ${c.label}`).sort(),
    [
      "add field customers.email",
      "add ref invoices.order_id → purchases.id",
      "add table invoices",
      "remove field customers.name",
      "update field purchases.total",
      "update table purchases",
    ].sort(),
  );
  assert.ok(plan.changes.every((c) => !c.conflict));

  const result = applyVariantSync(synced, base, variant);
  assert.deepEqual(
    result.tables.map((t) => t.name),
    ["customers", "purchases", "invoices"],
  );
  assert.deepEqual(
    result.tables[0].fields.map((f) => f.name),
    ["id", "email"],
  );
  assert.equal(result.tables[0].fields[1].unique, true);
  assert.deepEqual(result.tables[0].position, { x: 500, y: 300 });
  assert.equal(result.tables[1].fields[2].type, "decimal(12,2)");
  assert.deepEqual(
    result.refs.map((r) => r.id),
    ["r1", "r2"],
  );
  // Sent again with nothing new: nothing left.
  assert.deepEqual(planVariantSync(base, base, result).changes, []);
});

test("the client's own changes stay, and those the original also made are conflicts the client wins by default", () => {
  const base = clone(synced);
  base.tables[0].fields[1] = field("customers", "name", "varchar(100)");
  base.tables[1].fields.push(field("orders", "status", "text"));

  const variant = clone(synced);
  // The client's own column, and their own type for the same field.
  variant.tables[0].fields[1] = field("customers", "name", "varchar(255)");
  variant.tables[1].fields.push(field("orders", "client_ref", "text"));

  const plan = planVariantSync(synced, base, variant);
  const conflict = plan.changes.find((c) => c.key === "field:customers:customers.name")!;
  assert.equal(conflict.conflict, "variant-changed");
  assert.equal(plan.changes.find((c) => c.key === "field:orders:orders.status")?.conflict, undefined);

  const kept = applyVariantSync(synced, base, variant);
  assert.equal(kept.tables[0].fields[1].type, "varchar(255)");
  assert.deepEqual(
    kept.tables[1].fields.map((f) => f.name),
    ["id", "customer_id", "total", "status", "client_ref"],
  );

  const taken = applyVariantSync(synced, base, variant, { "field:customers:customers.name": "base" });
  assert.equal(taken.tables[0].fields[1].type, "varchar(100)");

  // A change the person chose not to send stays out.
  const skipped = applyVariantSync(synced, base, variant, { "field:orders:orders.status": "variant" });
  assert.equal(
    skipped.tables[1].fields.some((f) => f.name === "status"),
    false,
  );

  const status = variantStatus(synced, base, variant);
  assert.deepEqual(status, { pending: 2, conflicts: 1, customizations: 2 });
});

test("a table the client deleted is a conflict when the original changes it, and comes back only if asked", () => {
  const base = clone(synced);
  base.tables[1].fields.push(field("orders", "status", "text"));
  const variant = clone(synced);
  variant.tables = variant.tables.filter((t) => t.id !== "orders");
  variant.refs = [];

  const plan = planVariantSync(synced, base, variant);
  assert.deepEqual(
    plan.changes.map((c) => [c.key, c.conflict]),
    [["table:orders", "variant-removed"]],
  );
  assert.equal(applyVariantSync(synced, base, variant).tables.length, 1);
  const back = applyVariantSync(synced, base, variant, { "table:orders": "base" });
  assert.deepEqual(
    back.tables.map((t) => t.id),
    ["customers", "orders"],
  );
  assert.equal(back.tables[1].fields.length, 4);
});

test("a table removed by the original goes only if the client left it as it was", () => {
  const base = clone(synced);
  base.tables = base.tables.filter((t) => t.id !== "orders");
  base.refs = [];

  const untouched = applyVariantSync(synced, base, clone(synced));
  assert.deepEqual(
    untouched.tables.map((t) => t.id),
    ["customers"],
  );
  assert.deepEqual(untouched.refs, [], "its relation goes with it");

  const customised = clone(synced);
  customised.tables[1].fields.push(field("orders", "client_ref", "text"));
  const plan = planVariantSync(synced, base, customised);
  assert.equal(plan.changes.find((c) => c.key === "table:orders")?.conflict, "variant-changed");
  assert.equal(applyVariantSync(synced, base, customised).tables.length, 2);
});

test("a removed field takes its index and relations with it; enums and groups travel whole", () => {
  const base = clone(synced);
  base.tables[1].fields = base.tables[1].fields.filter((f) => f.name !== "customer_id");
  base.refs = [];
  base.enums = [{ id: "e1", name: "status", values: [{ id: "v1", name: "open" }], position: { x: 0, y: 0 } }];
  base.tableGroups = [{ id: "g1", name: "sales", tableIds: ["orders", "customers"] }];

  const variant = clone(synced);
  variant.tables[1].indexes = [{ id: "i1", fieldIds: ["orders.customer_id"] }];

  const result = applyVariantSync(synced, base, variant);
  assert.deepEqual(result.tables[1].indexes, []);
  assert.deepEqual(result.refs, []);
  assert.equal(result.enums[0].name, "status");
  assert.deepEqual(result.tableGroups[0].tableIds, ["orders", "customers"]);
});

test("a variant reset on its original, or copied from another variant, takes its schema and keeps its own layout", () => {
  const variant = clone(synced);
  variant.tables[0].position = { x: 900, y: 40 };
  variant.tables[0].fields.push(field("customers", "client_ref", "text"));
  variant.zones = [{ id: "z1", label: "Client", position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }];

  const other = clone(synced);
  other.tables.push(table("invoices", [field("invoices", "id")], { position: { x: 5, y: 5 } }));
  other.tables[1].fields[2] = field("orders", "total", "money");

  const copied = replaceVariantSchema(variant, other);
  assert.deepEqual(
    copied.tables.map((t) => t.id),
    ["customers", "orders", "invoices"],
  );
  assert.deepEqual(copied.tables[0].position, { x: 900, y: 40 }, "the variant's own place");
  assert.deepEqual(copied.tables[2].position, { x: 5, y: 5 }, "a new table at the other's place");
  assert.equal(
    copied.tables[0].fields.some((f) => f.name === "client_ref"),
    false,
  );
  assert.equal(copied.tables[1].fields[2].type, "money");
  assert.equal(copied.zones.length, 1);
  // Nothing left between the copy and its source.
  assert.deepEqual(planVariantSync(other, other, copied).changes, []);
  assert.equal(variantStatus(other, other, copied).customizations, 0);
});
