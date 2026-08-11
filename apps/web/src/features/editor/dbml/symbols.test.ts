import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { dbmlSignature, findField, findTable, parseDbmlSymbols, tableAt } from "@/features/editor/dbml/symbols";

const parse = (source: string) => parseDbmlSymbols(Text.of(source.split("\n")));

test("parses a table with fields and pk/unique/notNull/increment settings", () => {
  const symbols = parse(`
Table users {
  id int [pk, increment]
  email varchar [unique, not null]
  bio text
}
`);
  assert.equal(symbols.tables.length, 1);
  const users = symbols.tables[0];
  assert.equal(users.name, "users");
  assert.equal(users.fields.length, 3);

  const id = users.fields.find((f) => f.name === "id")!;
  assert.equal(id.pk, true);
  assert.equal(id.increment, true);

  const email = users.fields.find((f) => f.name === "email")!;
  assert.equal(email.unique, true);
  assert.equal(email.notNull, true);

  const bio = users.fields.find((f) => f.name === "bio")!;
  assert.equal(bio.pk, false);
  assert.equal(bio.type, "text");
});

test("parses a table's schema-qualified name, alias and note", () => {
  const symbols = parse(`
Table public.orders as o {
  id int [pk]
  Note: 'customer orders'
}
`);
  const orders = symbols.tables[0];
  assert.equal(orders.name, "orders");
  assert.equal(orders.schema, "public");
  assert.equal(orders.alias, "o");
  assert.equal(orders.note, "customer orders");
});

test("parses an enum's values", () => {
  const symbols = parse(`
Enum status {
  active
  archived
  deleted
}
`);
  assert.equal(symbols.enums.length, 1);
  assert.deepEqual(
    symbols.enums[0].values.map((v) => v.name),
    ["active", "archived", "deleted"],
  );
});

test("parses a top-level Ref block and an inline ref: setting the same way", () => {
  const symbols = parse(`
Table users { id int [pk] }
Table posts {
  id int [pk]
  user_id int [ref: > users.id]
}
Ref: posts.user_id > users.id
`);
  assert.equal(symbols.refs.length, 1, "the top-level Ref block");
  assert.equal(symbols.refs[0].relation, ">");
  assert.equal(symbols.refs[0].left.table, "posts");
  assert.equal(symbols.refs[0].right.table, "users");

  const userIdField = symbols.tables.find((t) => t.name === "posts")!.fields.find((f) => f.name === "user_id")!;
  assert.equal(userIdField.inlineRefs.length, 1);
  assert.equal(userIdField.inlineRefs[0].table, "users");
  assert.equal(userIdField.inlineRefs[0].field, "id");
});

test("parses a TableGroup's members", () => {
  const symbols = parse(`
Table a { id int [pk] }
Table b { id int [pk] }
TableGroup core {
  a
  b
}
`);
  assert.equal(symbols.groups.length, 1);
  assert.deepEqual(
    symbols.groups[0].members.map((m) => m.name),
    ["a", "b"],
  );
});

test("line comments and block comments are masked out, not parsed as content", () => {
  const symbols = parse(`
// Table decoy { id int [pk] }
Table users {
  id int [pk] // primary key
  /* email varchar */
  name varchar
}
`);
  assert.equal(symbols.tables.length, 1, "the commented-out decoy table isn't parsed as a real table");
  assert.equal(symbols.tables[0].fields.length, 2, "the commented-out email field isn't parsed as a real field");
});

test("an unclosed table block is reported as danglingOpen, and still resolves via tableAt up to EOF", () => {
  const source = `Table users {\n  id int [pk]\n`;
  const symbols = parse(source);
  assert.equal(symbols.danglingOpen, 1);
  const doc = Text.of(source.split("\n"));
  assert.equal(tableAt(symbols, doc, doc.line(2).from)?.name, "users");
});

test("a stray closing brace with no open block is reported", () => {
  const symbols = parse(`Table a { id int [pk] }\n}\n`);
  assert.deepEqual(symbols.strayClose, [2]);
});

test("findTable is case-insensitive and resolves by alias too", () => {
  const symbols = parse(`Table Users as u { id int [pk] }`);
  assert.equal(findTable(symbols, "users")?.name, "Users");
  assert.equal(findTable(symbols, "USERS")?.name, "Users");
  assert.equal(findTable(symbols, "u")?.name, "Users");
  assert.equal(findTable(symbols, "nope"), undefined);
});

test("findField is case-insensitive", () => {
  const symbols = parse(`
Table users {
  Email varchar
}
`);
  const users = symbols.tables[0];
  assert.equal(findField(users, "email")?.name, "Email");
  assert.equal(findField(users, "nope"), undefined);
});

test("dbmlSignature is stable across reformatting, comment changes and settings order", () => {
  const a = `
Table users {
  id int [pk, increment]
  email varchar [unique]
}
`;
  const b = `
// a comment that shouldn't affect the signature
Table   users   {
  id int [increment, pk]
  email varchar [unique]   // another comment
}
`;
  assert.equal(dbmlSignature(a), dbmlSignature(b));
});

test("dbmlSignature changes when the actual schema changes", () => {
  const original = `
Table users {
  id int [pk]
}
`;
  const withNewField = `
Table users {
  id int [pk]
  email varchar
}
`;
  assert.notEqual(dbmlSignature(original), dbmlSignature(withNewField));
});

test("dbmlSignature ignores table/field declaration order", () => {
  const a = `
Table a {
  id int [pk]
}
Table b {
  id int [pk]
}
`;
  const b = `
Table b {
  id int [pk]
}
Table a {
  id int [pk]
}
`;
  assert.equal(dbmlSignature(a), dbmlSignature(b));
});
