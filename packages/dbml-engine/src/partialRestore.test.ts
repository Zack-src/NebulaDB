import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Ref, Table } from "@athanordb/shared";
import { restoreTables } from "./partialRestore.js";

function table(id: string, name: string, fieldIds: string[] = ["id"]): Table {
  return {
    id,
    name,
    fields: fieldIds.map((fieldId) => ({ id: `${id}.${fieldId}`, name: fieldId, type: "int" })),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

function ref(id: string, fromTable: string, fromField: string, toTable: string, toField = "id"): Ref {
  return {
    id,
    from: { tableId: fromTable, fieldId: `${fromTable}.${fromField}` },
    to: { tableId: toTable, fieldId: `${toTable}.${toField}` },
    cardinality: "one-to-many",
  };
}

function project(tables: Table[], refs: Ref[] = [], tableGroups: Project["tableGroups"] = []): Project {
  return { id: "p", name: "P", tables, refs, enums: [], zones: [], stickyNotes: [], tableGroups };
}

test("a changed table goes back to the revision's version; the others stay as they are now", () => {
  const revision = project([table("users", "users", ["id", "email"]), table("orders", "orders")]);
  const current = project([table("users", "customers", ["id"]), table("orders", "orders_v2")]);

  const result = restoreTables(current, revision, ["users"]);

  assert.deepEqual(
    result.tables.map((t) => [t.name, t.fields.map((f) => f.name)]),
    [
      ["users", ["id", "email"]],
      ["orders_v2", ["id"]],
    ],
  );
});

test("a table deleted since the revision comes back; one created since is removed", () => {
  const revision = project([table("users", "users"), table("legacy", "legacy")]);
  const current = project(
    [table("users", "users"), table("fresh", "fresh")],
    [],
    [{ id: "g", name: "G", tableIds: ["users", "fresh"] }],
  );

  const result = restoreTables(current, revision, ["legacy", "fresh"]);

  assert.deepEqual(
    result.tables.map((t) => t.name),
    ["users", "legacy"],
  );
  assert.deepEqual(result.tableGroups[0].tableIds, ["users"], "a group forgets the table the restore removed");
});

test("foreign keys follow the table that carries them", () => {
  // Revision: orders → users. Now: that FK is gone and audit → orders exists.
  const revision = project(
    [table("users", "users"), table("orders", "orders", ["id", "user_id"]), table("audit", "audit")],
    [ref("r-orders-users", "orders", "user_id", "users")],
  );
  const current = project(
    [
      table("users", "users"),
      table("orders", "orders", ["id", "user_id"]),
      table("audit", "audit", ["id", "order_id"]),
    ],
    [ref("r-audit-orders", "audit", "order_id", "orders")],
  );

  const result = restoreTables(current, revision, ["orders"]);

  assert.deepEqual(
    result.refs.map((r) => r.id).sort(),
    ["r-audit-orders", "r-orders-users"],
    "orders gets its own FK back; the FK audit carries towards it is not touched",
  );
});

test("a relation whose target the restore removed is dropped, not left dangling", () => {
  const revision = project([table("users", "users")]);
  const current = project(
    [table("users", "users"), table("orders", "orders", ["id", "user_id"]), table("fresh", "fresh")],
    [ref("r-orders-fresh", "orders", "user_id", "fresh")],
  );

  const result = restoreTables(current, revision, ["fresh"]);

  assert.deepEqual(result.refs, []);
  assert.deepEqual(
    result.tables.map((t) => t.name),
    ["users", "orders"],
  );
});

test("a revision FK pointing at a column that no longer exists is not restored", () => {
  const revision = project(
    [table("users", "users", ["id", "code"]), table("orders", "orders", ["id", "user_code"])],
    [ref("r", "orders", "user_code", "users", "code")],
  );
  const current = project([table("users", "users", ["id"]), table("orders", "orders", ["id"])]);

  assert.deepEqual(restoreTables(current, revision, ["orders"]).refs, []);
});
