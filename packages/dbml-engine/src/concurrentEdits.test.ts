import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Table } from "@athanordb/shared";
import { preserveConcurrentAdditions } from "./concurrentEdits.js";

function table(name: string, fieldNames: string[]): Table {
  return {
    id: `t-${name}`,
    name,
    fields: fieldNames.map((field) => ({ id: `f-${name}-${field}`, name: field, type: "int" })),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

function project(tables: Table[]): Project {
  return { id: "p1", name: "Test", tables, refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

test("a table someone else added while the buffer was open is kept", () => {
  const baseline = project([table("users", ["id"])]);
  const current = project([table("users", ["id"]), table("orders", ["id"])]);
  const merged = project([table("users", ["id", "email"])]);

  const result = preserveConcurrentAdditions(current, merged, baseline);

  assert.deepEqual(
    result.tables.map((t) => t.name).sort(),
    ["orders", "users"],
    "the concurrently-added table must survive an import that never saw it",
  );
  assert.deepEqual(result.tables.find((t) => t.name === "users")?.fields.map((f) => f.name), ["id", "email"]);
});

test("a table the buffer's author deleted is still deleted", () => {
  const baseline = project([table("users", ["id"]), table("legacy", ["id"])]);
  const current = project([table("users", ["id"]), table("legacy", ["id"])]);
  const merged = project([table("users", ["id"])]);

  const result = preserveConcurrentAdditions(current, merged, baseline);

  assert.deepEqual(result.tables.map((t) => t.name), ["users"], "a deletion the baseline confirms must go through");
});

test("a column someone else added is kept, one the author deleted is not", () => {
  const baseline = project([table("users", ["id", "nickname"])]);
  const current = project([table("users", ["id", "nickname", "added_by_peer"])]);
  const merged = project([table("users", ["id"])]);

  const result = preserveConcurrentAdditions(current, merged, baseline);

  assert.deepEqual(result.tables[0].fields.map((f) => f.name), ["id", "added_by_peer"]);
});

test("refs added by someone else survive; the ones the buffer dropped do not", () => {
  const users = table("users", ["id"]);
  const orders = table("orders", ["id", "user_id"]);
  const carts = table("carts", ["id", "user_id"]);
  const ordersRef = {
    id: "r-orders",
    from: { tableId: orders.id, fieldId: "f-orders-user_id" },
    to: { tableId: users.id, fieldId: "f-users-id" },
    cardinality: "one-to-many" as const,
  };
  const cartsRef = {
    id: "r-carts",
    from: { tableId: carts.id, fieldId: "f-carts-user_id" },
    to: { tableId: users.id, fieldId: "f-users-id" },
    cardinality: "one-to-many" as const,
  };

  const baseline = { ...project([users, orders, carts]), refs: [ordersRef] };
  const current = { ...project([users, orders, carts]), refs: [ordersRef, cartsRef] };
  // The buffer's author removed the orders ref and never knew about the carts one.
  const merged = { ...project([users, orders, carts]), refs: [] };

  const result = preserveConcurrentAdditions(current, merged, baseline);

  assert.deepEqual(result.refs.map((r) => r.id), ["r-carts"]);
});

test("an enum added by someone else is kept", () => {
  const baseline = { ...project([]), enums: [] };
  const current = {
    ...project([]),
    enums: [{ id: "e1", name: "status", values: [{ id: "v1", name: "active" }], position: { x: 0, y: 0 } }],
  };
  const merged = project([]);

  const result = preserveConcurrentAdditions(current, merged, baseline);

  assert.deepEqual(result.enums.map((e) => e.name), ["status"]);
});
