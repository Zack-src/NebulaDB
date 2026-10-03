import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Ref, Table } from "./schema.js";
import { findLockViolations, revertLockViolations, type LockableSchema } from "./tableLocks.js";

function field(id: string, name: string, extra: Partial<Field> = {}): Field {
  return { id, name, type: "int", ...extra };
}

function table(id: string, fields: Field[], extra: Partial<Table> = {}): Table {
  return { id, name: id, fields, indexes: [], position: { x: 0, y: 0 }, detailLevel: "full", ...extra };
}

function ref(id: string, from: [string, string], to: [string, string]): Ref {
  return {
    id,
    from: { tableId: from[0], fieldId: from[1] },
    to: { tableId: to[0], fieldId: to[1] },
    cardinality: "one-to-many",
  };
}

const users = table("users", [field("u1", "id", { pk: true }), field("u2", "email", { unique: true })]);
const orders = table("orders", [field("o1", "id", { pk: true }), field("o2", "user_id")]);
const base: LockableSchema = { tables: [users, orders], refs: [ref("r1", ["orders", "o2"], ["users", "u1"])] };

const withTable = (schema: LockableSchema, next: Table): LockableSchema => ({
  ...schema,
  tables: schema.tables.map((t) => (t.id === next.id ? next : t)),
});

test("nothing locked, or nothing touched: no violation", () => {
  const changed = withTable(base, { ...users, name: "customers" });
  assert.deepEqual(findLockViolations(base, changed, []), []);
  assert.deepEqual(findLockViolations(base, changed, ["orders"]), []);
  assert.deepEqual(findLockViolations(base, base, ["users", "orders"]), []);
});

test("looks are not structure: moving, recolouring and commenting a locked table is allowed", () => {
  const moved = withTable(base, {
    ...users,
    position: { x: 400, y: 80 },
    size: { width: 300, height: 200 },
    style: { color: "#ff0000" },
    detailLevel: "compact",
    comments: [{ id: "c1", author: "bob", text: "hello", createdAt: "2026-10-02" }],
  });
  assert.deepEqual(findLockViolations(base, moved, ["users"]), []);
});

test("rename, column change, added column, index, note and deletion are all violations", () => {
  const cases: [string, LockableSchema][] = [
    ["rename", withTable(base, { ...users, name: "customers" })],
    ["type", withTable(base, { ...users, fields: [users.fields[0], { ...users.fields[1], type: "text" }] })],
    ["constraint", withTable(base, { ...users, fields: [users.fields[0], { ...users.fields[1], notNull: true }] })],
    ["added column", withTable(base, { ...users, fields: [...users.fields, field("u3", "name")] })],
    ["column order", withTable(base, { ...users, fields: [users.fields[1], users.fields[0]] })],
    ["index", withTable(base, { ...users, indexes: [{ id: "i1", fieldIds: ["u2"], unique: true }] })],
    ["note", withTable(base, { ...users, note: "customers of the shop" })],
  ];
  for (const [label, after] of cases) {
    assert.deepEqual(
      findLockViolations(base, after, ["users"]),
      [{ tableId: "users", tableName: "users", kind: "changed" }],
      label,
    );
  }
  const removed = { tables: [orders], refs: [] };
  assert.deepEqual(findLockViolations(base, removed, ["users"]), [
    { tableId: "users", tableName: "users", kind: "removed" },
  ]);
});

test("new ids for the same columns (DBML round trip, pull) are not a change", () => {
  const reIded = {
    tables: [
      { ...users, fields: [field("x1", "id", { pk: true }), field("x2", "email", { unique: true })] },
      { ...orders, fields: [field("y1", "id", { pk: true }), field("y2", "user_id")] },
    ],
    refs: [ref("other-id", ["orders", "y2"], ["users", "x1"])],
  };
  assert.deepEqual(findLockViolations(base, reIded, ["users", "orders"]), []);
});

test("a foreign key belongs to the table that carries the column, not to the one it points at", () => {
  const withoutRef = { ...base, refs: [] };
  assert.deepEqual(findLockViolations(base, withoutRef, ["users"]), [], "users is only pointed at");
  assert.deepEqual(findLockViolations(base, withoutRef, ["orders"]), [
    { tableId: "orders", tableName: "orders", kind: "changed" },
  ]);
  const cascade = { ...base, refs: [{ ...base.refs[0], onDelete: "cascade" as const }] };
  assert.equal(findLockViolations(base, cascade, ["orders"]).length, 1);
  // A reference to a locked table from a new, unlocked one is fine.
  const audit = table("audit", [field("a1", "user_id")]);
  const pointing = {
    tables: [...base.tables, audit],
    refs: [...base.refs, ref("r2", ["audit", "a1"], ["users", "u1"])],
  };
  assert.deepEqual(findLockViolations(base, pointing, ["users", "orders"]), []);
});

test("revert puts the structure back, keeps the looks and everything unrelated", () => {
  const products = table("products", [field("p1", "id")]);
  const after: LockableSchema = {
    tables: [
      { ...users, name: "customers", position: { x: 500, y: 500 }, fields: [users.fields[0]] },
      { ...orders, fields: [...orders.fields, field("o3", "total")] },
      products,
    ],
    refs: [],
  };
  const violations = findLockViolations(base, after, ["users", "orders"]);
  assert.equal(violations.length, 2);
  // Only `users` is reverted here, as if `orders` were not locked for this user.
  const reverted = revertLockViolations(base, after, [violations[0]]);
  const revertedUsers = reverted.tables.find((t) => t.id === "users")!;
  assert.equal(revertedUsers.name, "users");
  assert.equal(revertedUsers.fields.length, 2);
  assert.deepEqual(revertedUsers.position, { x: 500, y: 500 }, "the move is kept");
  assert.equal(reverted.tables.find((t) => t.id === "orders")!.fields.length, 3, "unlocked change kept");
  assert.ok(
    reverted.tables.some((t) => t.id === "products"),
    "unrelated addition kept",
  );

  const full = revertLockViolations(base, after, violations);
  assert.deepEqual(findLockViolations(base, full, ["users", "orders"]), []);
  assert.equal(full.refs.length, 1, "the locked table's foreign key is back");
});

test("revert restores a deleted locked table", () => {
  const after = { tables: [orders], refs: [] };
  const violations = findLockViolations(base, after, ["users"]);
  const reverted = revertLockViolations(base, after, violations);
  assert.deepEqual(findLockViolations(base, reverted, ["users"]), []);
  assert.ok(reverted.tables.some((t) => t.id === "users"));
});
