import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDbml, toProject } from "./dbml.js";
import { projectToDbml } from "./serialize.js";

/**
 * dbdiagram.io is the reference DBML producer. These fixtures follow what its
 * editor and "Export to DBML" emit, to pin that the NebulaDB pipeline
 * (parseDbml -> toProject -> projectToDbml -> parseDbml) accepts them.
 */

const EXPORT = `
Project ecommerce {
  database_type: 'PostgreSQL'
  Note: '''
    # E-commerce
    Exported from dbdiagram.io
  '''
}

Enum "order_status" {
  "created" [note: 'Waiting to be paid']
  "paid"
  "shipped"
}

Table "users" [headercolor: #3498db] {
  "id" integer [pk, increment]
  "email" varchar(255) [unique, not null]
  "full_name" varchar
  "created_at" timestamp [not null, default: \`now()\`]
  "role" varchar [default: 'customer', note: 'customer | admin']
  Note: 'Registered accounts'
}

Table "orders" {
  "id" integer [pk, increment]
  "user_id" integer [not null]
  "status" order_status [default: 'created']
  "total" "decimal"(12,2)
  "tags" text[]
  Indexes {
    user_id
    (user_id, status) [name: 'orders_user_status']
    \`lower(status::text)\` [name: 'orders_status_expr']
  }
}

Table "order_items" as OI {
  "order_id" integer
  "product_id" integer
  "quantity" integer [default: 1]
  Indexes {
    (order_id, product_id) [pk]
  }
}

Table "catalog"."products" {
  "id" integer [pk]
  "title" varchar [not null]
  "price" decimal(10,2) [default: -1]
}

TableGroup shop [color: #345] {
  users
  orders
}

Ref "fk_orders_user":"users"."id" < "orders"."user_id" [delete: cascade, update: no action, color: #ff0000]
Ref: OI.order_id > orders.id [delete: cascade]
Ref: OI.product_id > catalog.products.id
Ref: users.id - users.id
`;

test("dbdiagram export parses and survives a project round trip", () => {
  const source = EXPORT.replace('Ref: users.id - users.id\n', "");
  const db = parseDbml(source);
  const project = toProject(db, "dbdiagram", source);
  assert.equal(project.tables.length, 4);
  assert.equal(project.refs.length, 3);
  assert.equal(project.enums.length, 1);
  assert.equal(project.tableGroups.length, 1);

  const users = project.tables.find((t) => t.name === "users")!;
  assert.equal(users.note, "Registered accounts");
  assert.equal(users.fields.find((f) => f.name === "created_at")!.default, "now()");
  assert.equal(users.fields.find((f) => f.name === "created_at")!.defaultKind, "expression");
  assert.equal(users.fields.find((f) => f.name === "role")!.defaultKind, "string");

  const out = projectToDbml(project);
  const again = toProject(parseDbml(out), "dbdiagram", out);
  assert.equal(again.tables.length, 4);
  assert.equal(again.refs.length, 3);
  assert.equal(again.enums.length, 1);
});

test("dbdiagram: ref cardinality, direction, actions and names", () => {
  const source = EXPORT.replace('Ref: users.id - users.id\n', "");
  const project = toProject(parseDbml(source), "d", source);
  const name = (id: string) => project.tables.find((t) => t.id === id)!.name;
  const fk = project.refs.find((r) => r.name === "fk_orders_user")!;
  // `users.id < orders.user_id`: orders owns the FK
  assert.equal(name(fk.from.tableId), "orders");
  assert.equal(name(fk.to.tableId), "users");
  assert.equal(fk.cardinality, "one-to-many");
  assert.equal(fk.onDelete, "cascade");
  assert.equal(fk.onUpdate, "no action");
});

test("dbdiagram: table alias is resolved in refs", () => {
  const source = EXPORT.replace('Ref: users.id - users.id\n', "");
  const project = toProject(parseDbml(source), "d", source);
  const items = project.tables.find((t) => t.name === "order_items")!;
  const owned = project.refs.filter((r) => r.from.tableId === items.id);
  assert.equal(owned.length, 2);
});

test("dbdiagram: capitalised Indexes block, composite pk and expression index", () => {
  const source = EXPORT.replace('Ref: users.id - users.id\n', "");
  const project = toProject(parseDbml(source), "d", source);
  const orders = project.tables.find((t) => t.name === "orders")!;
  assert.equal(orders.indexes.length, 3);
  assert.ok(orders.indexes.some((i) => i.name === "orders_user_status" && i.fieldIds.length === 2));
  const items = project.tables.find((t) => t.name === "order_items")!;
  assert.ok(items.indexes.some((i) => i.pk && i.fieldIds.length === 2));
});

test("dbdiagram: schema-qualified table and array / sized types", () => {
  const source = EXPORT.replace('Ref: users.id - users.id\n', "");
  const project = toProject(parseDbml(source), "d", source);
  assert.equal(project.tables.find((t) => t.name === "products")!.schemaName, "catalog");
  const orders = project.tables.find((t) => t.name === "orders")!;
  assert.equal(orders.fields.find((f) => f.name === "tags")!.type, "text[]");
  assert.match(orders.fields.find((f) => f.name === "total")!.type, /^decimal/);
});

test("dbdiagram: one-to-one, many-to-many and composite refs", () => {
  const source = `
Table a { id int [pk]\n x int\n y int }
Table b { id int [pk]\n x int\n y int }
Table c { id int [pk] }
Ref: a.id - b.id
Ref: a.x <> c.id
`;
  const project = toProject(parseDbml(source), "d", source);
  assert.deepEqual(project.refs.map((r) => r.cardinality).sort(), ["many-to-many", "one-to-one"]);
});

test("dbdiagram: sticky notes, comments and one-line bodies are accepted", () => {
  const source = `
// comment
Note sticky_1 {
  'a sticky note'
}
Table a { /* inline */ id int [pk] // trailing
}
`;
  const project = toProject(parseDbml(source), "d", source);
  assert.equal(project.tables.length, 1);
});

test("dbdiagram: ref actions in every spelling", () => {
  const source = `
Table p { id int [pk] }
Table c { id int [pk]\n p int }
Ref: c.p > p.id [delete: set null, update: set default]
`;
  const project = toProject(parseDbml(source), "d", source);
  assert.equal(project.refs[0].onDelete, "set null");
  assert.equal(project.refs[0].onUpdate, "set default");
});

test("dbdiagram: quoted multi-word types parse, and re-serialize quoted (SQL-imported ones too)", () => {
  const source = 'Table a {\n  x "double precision"\n  y "timestamp with time zone" [not null]\n  z decimal(10, 2)\n}';
  const project = toProject(parseDbml(source), "d", source);
  assert.equal(project.tables[0].fields[0].type, "double precision");
  const out = projectToDbml(project);
  assert.match(out, /"double precision"/);
  assert.match(out, /"timestamp with time zone"/);
  assert.doesNotMatch(out, /"decimal/);
  assert.doesNotThrow(() => parseDbml(out));
});
