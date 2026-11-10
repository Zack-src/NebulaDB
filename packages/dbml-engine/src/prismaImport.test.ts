import { test } from "node:test";
import assert from "node:assert/strict";
import { importPrisma } from "./prismaImport.js";
import { parseDbml } from "./dbml.js";

const ECOMMERCE = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN @map("admin")
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
}

/// A registered customer
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique @db.VarChar(255)
  name      String?
  role      Role     @default(USER)
  createdAt DateTime @default(now()) @map("created_at")
  orders    Order[]
  profile   Profile?

  @@map("users")
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String @db.Text
  userId Int    @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Product {
  id          String      @id @default(uuid())
  sku         String      @unique
  title       String
  price       Decimal     @db.Decimal(10, 2)
  stock       Int         @default(0)
  active      Boolean     @default(true)
  tags        String[]
  meta        Json?
  items       OrderItem[]

  @@index([title])
}

model Order {
  id         Int         @id @default(autoincrement())
  userId     Int
  status     OrderStatus @default(PENDING)
  total      Decimal     @db.Decimal(12, 2)
  placedAt   DateTime    @default(now())
  user       User        @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  items      OrderItem[]

  @@index([userId, status])
}

model OrderItem {
  orderId   Int
  productId String
  quantity  Int     @default(1)
  order     Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product   Product @relation(fields: [productId], references: [id])

  @@id([orderId, productId])
}
`;

function table(r: ReturnType<typeof importPrisma>, name: string) {
  const t = r.project.tables.find((x) => x.name === name);
  assert.ok(t, `table ${name} missing`);
  return t;
}
function field(r: ReturnType<typeof importPrisma>, tn: string, fn: string) {
  const f = table(r, tn).fields.find((x) => x.name === fn);
  assert.ok(f, `field ${tn}.${fn} missing`);
  return f;
}

test("prisma e-commerce: tables, @@map, @map and relation fields", () => {
  const r = importPrisma(ECOMMERCE);
  assert.deepEqual(r.project.tables.map((t) => t.name).sort(), ["Order", "OrderItem", "Product", "Profile", "users"]);
  // Virtual relation fields are not columns.
  assert.deepEqual(
    table(r, "users").fields.map((f) => f.name),
    ["id", "email", "name", "role", "created_at"],
  );
  assert.equal(table(r, "users").note, "A registered customer");
  assert.deepEqual(r.warnings, []);
});

test("prisma e-commerce: types, nullability, defaults", () => {
  const r = importPrisma(ECOMMERCE);
  const id = field(r, "users", "id");
  assert.equal(id.pk, true);
  assert.equal(id.increment, true);
  assert.equal(id.type, "integer");
  assert.equal(field(r, "users", "email").type, "varchar(255)");
  assert.equal(field(r, "users", "email").unique, true);
  assert.ok(!field(r, "users", "name").notNull);
  assert.equal(field(r, "users", "email").notNull, true);
  const created = field(r, "users", "created_at");
  assert.equal(created.default, "now()");
  assert.equal(created.defaultKind, "expression");
  assert.equal(field(r, "Product", "id").default, "gen_random_uuid()");
  assert.equal(field(r, "Product", "price").type, "decimal(10,2)");
  assert.equal(field(r, "Product", "stock").default, "0");
  assert.equal(field(r, "Product", "stock").defaultKind, "number");
  assert.equal(field(r, "Product", "active").defaultKind, "boolean");
  assert.equal(field(r, "Product", "tags").type, "text[]");
  assert.equal(field(r, "Product", "meta").type, "jsonb");
  // enum default resolves through the enum's @map
  assert.equal(field(r, "users", "role").default, "USER");
  assert.equal(field(r, "users", "role").type, "Role");
});

test("prisma e-commerce: enums with @map values", () => {
  const r = importPrisma(ECOMMERCE);
  assert.deepEqual(
    r.project.enums.map((e) => e.name),
    ["Role", "OrderStatus"],
  );
  assert.deepEqual(
    r.project.enums[0].values.map((v) => v.name),
    ["USER", "admin"],
  );
});

test("prisma e-commerce: refs, actions and cardinality", () => {
  const r = importPrisma(ECOMMERCE);
  const ids = new Map(r.project.tables.map((t) => [t.id, t.name]));
  const describe = (ref: (typeof r.project.refs)[number]) => {
    const from = r.project.tables.find((t) => t.id === ref.from.tableId)!;
    const to = r.project.tables.find((t) => t.id === ref.to.tableId)!;
    return `${ids.get(ref.from.tableId)}.${from.fields.find((f) => f.id === ref.from.fieldId)!.name}>${to.name}.${to.fields.find((f) => f.id === ref.to.fieldId)!.name}`;
  };
  const byDesc = new Map(r.project.refs.map((x) => [describe(x), x]));
  assert.equal(r.project.refs.length, 4);
  const orderUser = byDesc.get("Order.userId>users.id")!;
  assert.equal(orderUser.onDelete, "restrict");
  assert.equal(orderUser.onUpdate, "cascade");
  assert.equal(orderUser.cardinality, "one-to-many");
  assert.equal(byDesc.get("Profile.userId>users.id")!.cardinality, "one-to-one");
  assert.equal(byDesc.get("Profile.userId>users.id")!.onDelete, "cascade");
  assert.equal(byDesc.get("OrderItem.orderId>Order.id")!.onDelete, "cascade");
  assert.equal(byDesc.get("OrderItem.productId>Product.id")!.onDelete, undefined);
});

test("prisma e-commerce: composite @@id and @@index", () => {
  const r = importPrisma(ECOMMERCE);
  const oi = table(r, "OrderItem");
  const pk = oi.indexes.find((i) => i.pk);
  assert.ok(pk);
  assert.deepEqual(
    pk.fieldIds.map((id) => oi.fields.find((f) => f.id === id)!.name),
    ["orderId", "productId"],
  );
  assert.equal(field(r, "OrderItem", "orderId").notNull, true);
  const order = table(r, "Order");
  assert.equal(order.indexes.length, 1);
  assert.equal(order.indexes[0].fieldIds.length, 2);
  assert.ok(!order.indexes[0].unique);
});

test("prisma e-commerce: produced DBML is valid and re-parses", () => {
  const r = importPrisma(ECOMMERCE);
  const db = parseDbml(r.dbml);
  assert.equal(db.schemas[0].tables.length, 5);
  assert.equal(db.schemas[0].refs.length, 4);
  assert.equal(db.schemas[0].enums.length, 2);
});

const BLOG = `
datasource db {
  provider = "mysql"
  url = env("DATABASE_URL")
}

model Post {
  id         Int        @id @default(autoincrement())
  title      String     @db.VarChar(200)
  body       String     @db.LongText
  published  Boolean    @default(false)
  authorId   Int
  author     Author     @relation(fields: [authorId], references: [id])
  categories Category[]
  tags       Tag[]      @relation("PostTags")
  updatedAt  DateTime   @updatedAt
}

model Category {
  id    Int    @id @default(autoincrement())
  name  String @unique
  posts Post[]
}

model Tag {
  id    String @id @default(cuid())
  label String
  posts Post[] @relation("PostTags")
}

model Author {
  id    Int    @id @default(autoincrement())
  name  String
  posts Post[]
}
`;

test("prisma blog: mysql type mapping and updatedAt/cuid notes", () => {
  const r = importPrisma(BLOG);
  assert.equal(field(r, "Category", "name").type, "varchar(191)");
  assert.equal(field(r, "Post", "title").type, "varchar(200)");
  assert.equal(field(r, "Post", "body").type, "longtext");
  assert.equal(field(r, "Post", "updatedAt").type, "datetime(3)");
  assert.match(field(r, "Post", "updatedAt").note ?? "", /@updatedAt/);
  assert.match(field(r, "Tag", "id").note ?? "", /cuid/);
  assert.equal(field(r, "Tag", "id").default, undefined);
});

test("prisma blog: implicit many-to-many creates join tables", () => {
  const r = importPrisma(BLOG);
  const names = r.project.tables.map((t) => t.name);
  assert.ok(names.includes("_CategoryToPost"));
  assert.ok(names.includes("_PostTags"));
  const j = table(r, "_CategoryToPost");
  assert.deepEqual(
    j.fields.map((f) => f.name),
    ["A", "B"],
  );
  assert.equal(j.fields[0].type, "int");
  assert.ok(j.indexes.some((i) => i.unique && i.fieldIds.length === 2));
  const joinRefs = r.project.refs.filter((x) => x.from.tableId === j.id);
  assert.equal(joinRefs.length, 2);
  assert.ok(joinRefs.every((x) => x.onDelete === "cascade"));
  // A refs Category (alphabetically first), B refs Post
  const a = joinRefs.find((x) => x.from.fieldId.endsWith(".A"))!;
  assert.equal(a.to.tableId, table(r, "Category").id);
  // Tag id is cuid string -> A/B carry its type
  const pt = table(r, "_PostTags");
  assert.equal(pt.fields[1].type, "varchar(191)");
  assert.doesNotThrow(() => parseDbml(r.dbml));
});

test("prisma blog: back-relations produce no extra tables or refs", () => {
  const r = importPrisma(BLOG);
  assert.equal(r.project.tables.length, 6);
  assert.equal(r.project.refs.length, 1 + 4);
});

test("prisma: provider overrides and sqlite/sqlserver mapping", () => {
  const src = `model A { id Int @id @default(autoincrement())\n flag Boolean\n at DateTime @default(now())\n b BigInt }`;
  const sqlite = importPrisma(src, { provider: "sqlite" });
  assert.equal(field(sqlite, "A", "flag").type, "boolean");
  assert.equal(field(sqlite, "A", "at").default, "CURRENT_TIMESTAMP");
  const mssql = importPrisma(src, { provider: "sqlserver" });
  assert.equal(field(mssql, "A", "flag").type, "bit");
  assert.equal(field(mssql, "A", "at").default, "getdate()");
  assert.equal(field(mssql, "A", "at").type, "datetime2");
});

test("prisma: composite unique, named map, schema, dbgenerated, multi-line attrs", () => {
  const r = importPrisma(`
datasource db { provider = "postgresql" }
model Membership {
  id     Int    @id
  org    String
  member String
  slug   String @default(dbgenerated("lower(org)"))
  parent Membership? @relation(
    "Tree",
    fields: [parentId],
    references: [id],
    onDelete: SetNull
  )
  parentId Int?
  children Membership[] @relation("Tree")

  @@unique([org, member], name: "org_member")
  @@schema("auth")
  @@map("memberships")
}
`);
  const t = table(r, "memberships");
  assert.equal(t.schemaName, "auth");
  assert.equal(t.indexes[0].unique, true);
  assert.equal(t.indexes[0].name, "org_member");
  assert.equal(field(r, "memberships", "slug").default, "lower(org)");
  assert.equal(r.project.refs.length, 1);
  assert.equal(r.project.refs[0].onDelete, "set null");
  assert.equal(r.project.refs[0].cardinality, "one-to-many");
});

test("prisma: composite foreign key is split with a warning", () => {
  const r = importPrisma(`
model Parent { a Int\n b Int\n kids Child[]\n @@id([a, b]) }
model Child {
  id Int @id
  pa Int
  pb Int
  parent Parent @relation(fields: [pa, pb], references: [a, b])
}
`);
  assert.equal(r.project.refs.length, 2);
  assert.ok(r.warnings.some((w) => /Composite foreign key/.test(w.message)));
});

test("prisma: unsupported constructs warn, never throw", () => {
  const r = importPrisma(`
datasource db { provider = "postgresql" }
view Stats { id Int @unique }
type Address { street String }
model Weird {
  id Int @id
  loc Unsupported("point")?
  ghost String @ignore
  @@fulltext([id])
}
model Hidden { id Int @id\n @@ignore }
`);
  const msgs = r.warnings.map((w) => w.message).join("\n");
  assert.match(msgs, /View "Stats"/);
  assert.match(msgs, /Composite type "Address"/);
  assert.match(msgs, /Unsupported\("point"\)/);
  assert.match(msgs, /@ignore/);
  assert.match(msgs, /@@fulltext/);
  assert.equal(field(r, "Weird", "loc").type, "point");
  assert.ok(!r.project.tables.some((t) => t.name === "Hidden"));
});

test("prisma: garbage and partial input never throw", () => {
  for (const src of [
    "",
    "   ",
    "model {",
    "model A {\n id Int @id",
    "@@@@ nonsense }}}",
    "model A { id Int @relation( }",
  ]) {
    const r = importPrisma(src);
    assert.ok(Array.isArray(r.project.tables));
    assert.ok(Array.isArray(r.warnings));
  }
  const partial = importPrisma("model A {\n id Int @id\n name String");
  assert.equal(partial.project.tables.length, 1);
  assert.ok(partial.warnings.some((w) => /not closed/.test(w.message)));
});

test("prisma: scalar list on mysql falls back to json with warning; comments ignored", () => {
  const r = importPrisma(`
datasource db { provider = "mysql" } // comment
/* block
comment */
model A {
  id Int @id // trailing
  tags String[]
}`);
  assert.equal(field(r, "A", "tags").type, "json");
  assert.ok(r.warnings.some((w) => /Scalar list/.test(w.message)));
});

test("prisma: no datasource assumes postgresql with a warning; projectName honored", () => {
  const r = importPrisma("model A { id Int @id }", { projectName: "Mine" });
  assert.equal(r.project.name, "Mine");
  assert.equal(field(r, "A", "id").type, "integer");
  assert.ok(r.warnings.some((w) => /assuming postgresql/.test(w.message)));
});

test("prisma: CRLF input", () => {
  const r = importPrisma(ECOMMERCE.replace(/\n/g, "\r\n"));
  assert.equal(r.project.tables.length, 5);
});
