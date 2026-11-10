import { test } from "node:test";
import assert from "node:assert/strict";
import { importDrizzle } from "./drizzleImport.js";
import { parseDbml } from "./dbml.js";

const PG_SCHEMA = `
import { relations, sql } from "drizzle-orm";
import {
  pgTable, pgEnum, serial, integer, text, varchar, boolean, timestamp, uuid, jsonb,
  numeric, primaryKey, index, uniqueIndex, foreignKey, type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin", "guest"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: text("name"),
  role: roleEnum("role").default("user").notNull(),
  settings: jsonb("settings").$type<{ theme: string }>().default({}),
  ...timestamps,
});

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
});

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    sku: varchar("sku", { length: 32 }).notNull(),
    title: text("title").notNull(),
    price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0.00"),
    stock: integer("stock").notNull().default(0),
    active: boolean("active").default(true),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade", onUpdate: "restrict" }),
    addedAt: timestamp("added_at").default(sql\`now()\`),
    tags: text("tags").array(),
  },
  (t) => [
    uniqueIndex("products_sku_idx").on(t.sku),
    index("products_title_idx").on(t.title, t.categoryId),
  ],
);

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  total: numeric("total", { precision: 12, scale: 2 }),
});

export const orderItems = pgTable(
  "order_items",
  {
    orderId: integer("order_id").notNull(),
    productId: integer("product_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.orderId, table.productId] }),
    orderFk: foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: "oi_order_fk" }),
    productFk: foreignKey({ columns: [table.productId], foreignColumns: [products.id] }),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({ orders: many(orders) }));
`;

function ref(r: ReturnType<typeof importDrizzle>) {
  return r.project.refs.map((x) => {
    const from = r.project.tables.find((t) => t.id === x.from.tableId)!;
    const to = r.project.tables.find((t) => t.id === x.to.tableId)!;
    return {
      key: `${from.name}.${from.fields.find((f) => f.id === x.from.fieldId)!.name}>${to.name}.${to.fields.find((f) => f.id === x.to.fieldId)!.name}`,
      x,
    };
  });
}
function field(r: ReturnType<typeof importDrizzle>, t: string, f: string) {
  const fld = r.project.tables.find((x) => x.name === t)?.fields.find((x) => x.name === f);
  assert.ok(fld, `${t}.${f} missing`);
  return fld;
}

test("drizzle pg: tables and columns, spread of shared timestamps", () => {
  const r = importDrizzle(PG_SCHEMA);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.project.tables.map((t) => t.name),
    ["users", "categories", "products", "orders", "order_items"],
  );
  const users = r.project.tables[0];
  assert.deepEqual(
    users.fields.map((f) => f.name),
    ["id", "email", "name", "role", "settings", "created_at", "updated_at"],
  );
  assert.equal(field(r, "users", "id").pk, true);
  assert.equal(field(r, "users", "id").increment, true);
  assert.equal(field(r, "users", "id").type, "integer");
  assert.equal(field(r, "users", "email").type, "varchar(255)");
  assert.equal(field(r, "users", "email").unique, true);
  assert.equal(field(r, "users", "email").notNull, true);
  assert.equal(field(r, "users", "name").notNull, undefined);
  assert.equal(field(r, "users", "created_at").type, "timestamptz");
  assert.equal(field(r, "users", "created_at").default, "now()");
  assert.equal(field(r, "users", "created_at").defaultKind, "expression");
});

test("drizzle pg: enums, defaults of every kind", () => {
  const r = importDrizzle(PG_SCHEMA);
  assert.deepEqual(
    r.project.enums.map((e) => [e.name, e.values.map((v) => v.name)]),
    [["role", ["user", "admin", "guest"]]],
  );
  assert.equal(field(r, "users", "role").type, "role");
  assert.equal(field(r, "users", "role").default, "user");
  assert.equal(field(r, "users", "role").defaultKind, "string");
  assert.equal(field(r, "categories", "id").default, "gen_random_uuid()");
  assert.equal(field(r, "products", "price").type, "numeric(10,2)");
  assert.equal(field(r, "products", "price").default, "0.00");
  assert.equal(field(r, "products", "stock").default, "0");
  assert.equal(field(r, "products", "stock").defaultKind, "number");
  assert.equal(field(r, "products", "active").default, "true");
  assert.equal(field(r, "products", "active").defaultKind, "boolean");
  assert.equal(field(r, "products", "added_at").default, "now()");
  assert.equal(field(r, "products", "tags").type, "text[]");
  assert.equal(field(r, "users", "settings").type, "jsonb");
});

test("drizzle pg: references (inline, self, actions)", () => {
  const r = importDrizzle(PG_SCHEMA);
  const m = new Map(ref(r).map((e) => [e.key, e.x]));
  assert.equal(m.get("categories.parent_id>categories.id")!.onDelete, "set null");
  const pc = m.get("products.category_id>categories.id")!;
  assert.equal(pc.onDelete, "cascade");
  assert.equal(pc.onUpdate, "restrict");
  assert.ok(m.has("orders.user_id>users.id"));
  assert.equal(m.get("order_items.order_id>orders.id")!.name, "oi_order_fk");
  assert.ok(m.has("order_items.product_id>products.id"));
  assert.equal(r.project.refs.length, 5);
});

test("drizzle pg: indexes, composite primary key", () => {
  const r = importDrizzle(PG_SCHEMA);
  const products = r.project.tables.find((t) => t.name === "products")!;
  const uq = products.indexes.find((i) => i.unique)!;
  assert.equal(uq.name, "products_sku_idx");
  assert.equal(uq.fieldIds.length, 1);
  const plain = products.indexes.find((i) => !i.unique)!;
  assert.equal(plain.fieldIds.length, 2);
  const oi = r.project.tables.find((t) => t.name === "order_items")!;
  const pk = oi.indexes.find((i) => i.pk)!;
  assert.deepEqual(
    pk.fieldIds.map((id) => oi.fields.find((f) => f.id === id)!.name),
    ["order_id", "product_id"],
  );
});

test("drizzle pg: output is valid DBML", () => {
  const r = importDrizzle(PG_SCHEMA);
  const db = parseDbml(r.dbml);
  assert.equal(db.schemas[0].tables.length, 5);
  assert.equal(db.schemas[0].refs.length, 5);
});

test("drizzle mysql: types, autoincrement, mysqlEnum", () => {
  const r = importDrizzle(`
import { mysqlTable, int, varchar, mysqlEnum, text, datetime, decimal, serial } from "drizzle-orm/mysql-core";
export const posts = mysqlTable("posts", {
  id: int("id").primaryKey().autoincrement(),
  seq: serial("seq"),
  title: varchar("title", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["draft", "live"]).default("draft"),
  body: text("body"),
  at: datetime("at", { fsp: 3 }),
  price: decimal("price", { precision: 8, scale: 2 }),
});
`);
  assert.equal(field(r, "posts", "id").increment, true);
  assert.equal(field(r, "posts", "id").type, "int");
  assert.equal(field(r, "posts", "title").type, "varchar(120)");
  assert.equal(field(r, "posts", "at").type, "datetime(3)");
  assert.equal(field(r, "posts", "price").type, "decimal(8,2)");
  assert.equal(r.project.enums[0].name, "posts_status");
  assert.equal(field(r, "posts", "status").type, "posts_status");
  assert.equal(field(r, "posts", "seq").unique, true);
  assert.doesNotThrow(() => parseDbml(r.dbml));
});

test("drizzle sqlite: integer pk autoIncrement, text/real/blob, defaults", () => {
  const r = importDrizzle(`
import { sqliteTable, integer, text, real, blob } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
  score: real("score").default(0.5),
  data: blob("data"),
  done: integer("done", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql\`(unixepoch())\`),
  ownerId: integer("owner_id").references(() => notes.id),
});
`);
  assert.equal(field(r, "notes", "id").increment, true);
  assert.equal(field(r, "notes", "score").default, "0.5");
  assert.equal(field(r, "notes", "done").type, "integer");
  assert.equal(field(r, "notes", "done").default, "false");
  assert.equal(field(r, "notes", "created_at").default, "(unixepoch())");
  assert.equal(r.project.refs.length, 1);
  assert.doesNotThrow(() => parseDbml(r.dbml));
});

test("drizzle: pgSchema namespaces tables and enums", () => {
  const r = importDrizzle(`
import { pgSchema, serial, text, integer } from "drizzle-orm/pg-core";
export const auth = pgSchema("auth");
export const accounts = auth.table("accounts", { id: serial("id").primaryKey(), name: text("name") });
export const sessions = auth.table("sessions", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => accounts.id),
});
`);
  assert.deepEqual(
    r.project.tables.map((t) => t.schemaName),
    ["auth", "auth"],
  );
  assert.equal(r.project.refs.length, 1);
  assert.doesNotThrow(() => parseDbml(r.dbml));
});

test("drizzle: column key used when no db name given; unique on constraint; check warns", () => {
  const r = importDrizzle(`
import { pgTable, text, integer, unique, check } from "drizzle-orm/pg-core";
export const t = pgTable("t", {
  firstName: text(),
  a: integer("a"),
  b: integer("b"),
}, (t) => [unique("ab").on(t.a, t.b), check("c", sql\`a > 0\`)]);
`);
  assert.equal(field(r, "t", "firstName").type, "text");
  const t = r.project.tables[0];
  assert.equal(t.indexes[0].unique, true);
  assert.equal(t.indexes[0].name, "ab");
  assert.ok(r.warnings.some((w) => /check\(\)/.test(w.message)));
});

test("drizzle: unsupported shapes warn and keep the rest; never executes code", () => {
  const r = importDrizzle(`
import { pgTable, text, serial } from "drizzle-orm/pg-core";
const name = computeName();
globalThis.__pwned = true;
export const dyn = pgTable(name, { id: serial("id") });
export const ok = pgTable("ok", { id: serial("id").primaryKey(), x: weirdType("x"), ...unknownSpread });
`);
  assert.equal((globalThis as Record<string, unknown>).__pwned, undefined);
  assert.deepEqual(
    r.project.tables.map((t) => t.name),
    ["ok"],
  );
  assert.ok(r.warnings.some((w) => /non-literal name/.test(w.message)));
  assert.ok(r.warnings.some((w) => /weirdType/.test(w.message)));
  assert.ok(r.warnings.some((w) => /Spread/.test(w.message)));
});

test("drizzle: garbage and partial input never throw", () => {
  for (const src of [
    "",
    "pgTable(",
    "export const a = pgTable('a', {",
    "}}}} ))) ((",
    "const x = `unterminated",
    "export const a = pgTable('a', { id: serial('id').primaryKey(), ",
  ]) {
    const r = importDrizzle(src);
    assert.ok(Array.isArray(r.project.tables));
  }
  const partial = importDrizzle("export const a = pgTable('a', { id: serial('id').primaryKey(), n: text('n')");
  assert.equal(partial.project.tables.length, 1);
  assert.equal(partial.project.tables[0].fields.length, 2);
});

test("drizzle: comments, as const enums, references to later-declared tables", () => {
  const r = importDrizzle(`
// leading comment
export const posts = pgTable("posts", {
  /* block */ id: serial("id").primaryKey(),
  authorId: integer("author_id").references(() => authors.id), // later table
});
export const authors = pgTable("authors", { id: serial("id").primaryKey() });
export const kind = pgEnum("kind", ["a", "b"] as const);
`);
  assert.equal(r.project.refs.length, 1);
  assert.deepEqual(
    r.project.enums[0].values.map((v) => v.name),
    ["a", "b"],
  );
});
