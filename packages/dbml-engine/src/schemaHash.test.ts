import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Ref, Table } from "@athanordb/shared";
import { canonicalDefault, canonicalType, compareSchemas, diffFingerprints, fingerprintSchema } from "./schemaHash.js";
import { mergeProjectIntoExisting, parseDbml, toProject } from "./dbml.js";
import { projectToDbml } from "./serialize.js";

function field(name: string, type: string, extra: Partial<Field> = {}): Field {
  return { id: `f-${name}-${Math.random()}`, name, type, ...extra };
}

function table(name: string, fields: Field[], extra: Partial<Table> = {}): Table {
  return { id: `t-${name}`, name, fields, indexes: [], position: { x: 0, y: 0 }, detailLevel: "full", ...extra };
}

function ref(from: Table, fromField: string, to: Table, toField: string, extra: Partial<Ref> = {}): Ref {
  return {
    id: `r-${from.name}-${fromField}`,
    from: { tableId: from.id, fieldId: from.fields.find((f) => f.name === fromField)!.id },
    to: { tableId: to.id, fieldId: to.fields.find((f) => f.name === toField)!.id },
    cardinality: "one-to-many",
    ...extra,
  };
}

function shop() {
  const users = table("users", [
    field("id", "int", { pk: true, increment: true }),
    field("email", "varchar(255)", { unique: true, notNull: true }),
    field("status", "varchar", { default: "active", defaultKind: "string" }),
  ]);
  const orders = table("orders", [
    field("id", "int", { pk: true }),
    field("user_id", "int"),
    field("total", "numeric(10,2)"),
  ]);
  return { users, orders, tables: [users, orders], refs: [ref(orders, "user_id", users, "id")] };
}

test("canonical types unify an engine's own aliases and nothing else", () => {
  assert.equal(canonicalType("INTEGER"), "int");
  assert.equal(canonicalType("int4"), "int");
  assert.equal(canonicalType("  Character Varying ( 255 ) "), "varchar(255)");
  assert.equal(canonicalType("DECIMAL(10, 2)"), "numeric(10,2)");
  assert.equal(canonicalType("timestamptz"), "timestamp with time zone");
  assert.equal(canonicalType("int4[]"), "int[]");
  // Not aliases: a length is part of the type, and text is not varchar.
  assert.notEqual(canonicalType("varchar(255)"), canonicalType("varchar(320)"));
  assert.notEqual(canonicalType("varchar"), canonicalType("text"));
  assert.equal(canonicalType(undefined), "");
});

test("canonical defaults drop quoting and casts, keep the value's case", () => {
  assert.equal(canonicalDefault("'active'::character varying"), "active");
  assert.equal(canonicalDefault("('active')"), "active");
  assert.equal(canonicalDefault("active"), "active");
  assert.equal(canonicalDefault("'Active'"), "Active");
  assert.equal(canonicalDefault("NOW()"), "now()");
  assert.equal(canonicalDefault("CURRENT_TIMESTAMP"), "current_timestamp");
  assert.equal(canonicalDefault("'it''s'"), "it's");
  assert.equal(canonicalDefault(""), null);
  assert.equal(canonicalDefault(undefined), null);
});

test("the same structure hashes the same whatever the order, ids, case, looks and names of indexes", () => {
  const a = shop();
  const reference = fingerprintSchema(a);

  const b = shop();
  const shuffled = {
    tables: [
      {
        ...b.orders,
        name: "ORDERS",
        fields: [...b.orders.fields].reverse(),
        position: { x: 900, y: 40 },
        style: { color: "#f00" },
        note: "customer orders",
      },
      { ...b.users, fields: [...b.users.fields].reverse().map((f) => ({ ...f, note: "documented" })) },
    ],
    refs: b.refs,
  };
  assert.equal(fingerprintSchema(shuffled).hash, reference.hash);

  // A column-level `pk` / `unique` and the same thing declared as an index are one structure.
  const c = shop();
  const [id, email, status] = c.users.fields;
  const viaIndexes = {
    tables: [
      {
        ...c.users,
        fields: [{ ...id, pk: false }, { ...email, unique: false }, status],
        indexes: [
          { id: "i1", fieldIds: [id.id], pk: true },
          { id: "i2", fieldIds: [email.id], unique: true, name: "users_email_key" },
        ],
      },
      c.orders,
    ],
    refs: c.refs,
  };
  assert.equal(fingerprintSchema(viaIndexes).hash, reference.hash);

  // `NO ACTION` is the absence of an action.
  const d = shop();
  assert.equal(
    fingerprintSchema({ tables: d.tables, refs: [{ ...d.refs[0], onDelete: "no action" }] }).hash,
    reference.hash,
  );
});

test("every structural change moves the hash of its table, and of that table only", () => {
  const base = shop();
  const reference = fingerprintSchema(base);
  const usersHash = reference.tables.users.hash;
  const ordersHash = reference.tables.orders.hash;

  const withUsers = (change: (users: Table) => Table) => {
    const s = shop();
    return fingerprintSchema({ tables: [change(s.users), s.orders], refs: s.refs });
  };
  const edits: [string, (users: Table) => Table][] = [
    ["type", (u) => ({ ...u, fields: u.fields.map((f) => (f.name === "email" ? { ...f, type: "varchar(320)" } : f)) })],
    [
      "nullability",
      (u) => ({ ...u, fields: u.fields.map((f) => (f.name === "status" ? { ...f, notNull: true } : f)) }),
    ],
    ["default", (u) => ({ ...u, fields: u.fields.map((f) => (f.name === "status" ? { ...f, default: "new" } : f)) })],
    ["unique", (u) => ({ ...u, fields: u.fields.map((f) => (f.name === "email" ? { ...f, unique: false } : f)) })],
    ["added column", (u) => ({ ...u, fields: [...u.fields, field("phone", "text")] })],
    ["dropped column", (u) => ({ ...u, fields: u.fields.slice(0, 2) })],
    ["index", (u) => ({ ...u, indexes: [{ id: "i", fieldIds: [u.fields[2].id] }] })],
  ];
  for (const [label, change] of edits) {
    const next = withUsers(change);
    assert.notEqual(next.tables.users.hash, usersHash, label);
    assert.equal(next.tables.orders.hash, ordersHash, `${label}: orders untouched`);
    assert.deepEqual(diffFingerprints(reference, next).changed, ["users"], label);
  }

  // A foreign key belongs to the table that carries it.
  const s = shop();
  const noFk = fingerprintSchema({ tables: s.tables, refs: [] });
  assert.deepEqual(diffFingerprints(reference, noFk), {
    added: [],
    removed: [],
    changed: ["orders"],
    hasChanges: true,
  });
  const cascade = fingerprintSchema({ tables: s.tables, refs: [{ ...s.refs[0], onDelete: "cascade" }] });
  assert.deepEqual(diffFingerprints(reference, cascade).changed, ["orders"]);
});

test("diff names added and removed tables, and reports nothing for equal schemas", () => {
  const s = shop();
  const reference = fingerprintSchema(s);
  assert.deepEqual(diffFingerprints(reference, fingerprintSchema(shop())), {
    added: [],
    removed: [],
    changed: [],
    hasChanges: false,
  });
  const audit = table("Audit_Log", [field("id", "int")]);
  const next = fingerprintSchema({ tables: [s.users, audit], refs: [] });
  assert.deepEqual(diffFingerprints(reference, next), {
    added: ["Audit_Log"],
    removed: ["orders"],
    changed: [],
    hasChanges: true,
  });
  assert.throws(() => diffFingerprints(reference, { ...next, version: 2 as 1 }), /versions differ/);
});

test("a schema keeps its fingerprint through the DBML text", () => {
  const source = `Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  status varchar [default: 'active']
  created_at timestamp [default: \`now()\`]

  indexes {
    (email, status) [unique]
    status
  }
}

Table orders {
  id int [pk]
  user_id int [ref: > users.id]
}

Ref: orders.user_id > users.id [delete: cascade]
`;
  const empty = { id: "p", name: "p", tables: [], refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] };
  const first = mergeProjectIntoExisting(
    empty,
    toProject(parseDbml(source.replace(" [ref: > users.id]", "")), "p", source),
  );
  const text = projectToDbml(first);
  const second = mergeProjectIntoExisting(empty, toProject(parseDbml(text), "p", text));
  assert.equal(fingerprintSchema(second).hash, fingerprintSchema(first).hash);
  assert.equal(Object.keys(fingerprintSchema(first).tables).join(","), "orders,users");
});

test("two databases compared: what each has alone, what differs and how, what nobody modelled", () => {
  const source = shop();
  const target = shop();
  // The target is behind on `users` (a size, a missing column), ahead by a table, and lacks `orders`' key.
  target.users.fields[1] = field("email", "varchar(120)", { unique: true, notNull: true });
  target.users.fields.pop();
  target.users.fields.push(field("legacy_code", "text"));
  const audit = table("audit_copy", [field("id", "int")]);
  const invoices = table("invoices", [field("id", "int", { pk: true })]);
  const targetSchema = { tables: [target.users, audit], refs: [] };
  const sourceSchema = { tables: [...source.tables, invoices], refs: source.refs };

  const entries = compareSchemas(sourceSchema, targetSchema, sourceSchema);
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.status, entry.inSchema]),
    [
      ["audit_copy", "only-target", false],
      ["invoices", "only-source", true],
      ["orders", "only-source", true],
      ["users", "different", true],
    ],
  );
  assert.deepEqual(entries[3].detail, {
    columnsAdded: ["legacy_code"],
    columnsRemoved: ["status"],
    columnsChanged: [{ name: "email", before: "varchar(255) not null", after: "varchar(120) not null" }],
    primaryKeyChanged: false,
    indexesChanged: false,
    foreignKeysChanged: false,
  });

  assert.deepEqual(compareSchemas(sourceSchema, sourceSchema), []);
  // Without a reference schema, nothing is flagged as unmodelled.
  assert.ok(compareSchemas(sourceSchema, targetSchema).every((entry) => entry.inSchema));
});
