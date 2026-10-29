import { test } from "node:test";
import assert from "node:assert/strict";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { DatabaseEngine, DbAdminColumn, DbAdminTable, Table } from "@nebuladb/shared";
import {
  catalogKey,
  columnCompletions,
  mergeCatalog,
  referencedTables,
  toSqlSchema,
  type SqlCatalogTable,
} from "./sqlCatalog";
import { sqlLanguage } from "./sqlEditorSetup";

const dbTable = (name: string, schema: string | null = null, kind: "table" | "view" = "table"): DbAdminTable => ({
  schema,
  name,
  kind,
  rowEstimate: null,
  sizeBytes: null,
});
const dbColumn = (name: string, type: string, primaryKey = false): DbAdminColumn => ({
  name,
  type,
  nullable: !primaryKey,
  defaultValue: null,
  primaryKey,
});
const projectTable = (name: string, fields: [string, string, boolean?][]): Table =>
  ({
    id: name,
    name,
    fields: fields.map(([field, type, pk]) => ({ id: `${name}.${field}`, name: field, type, pk })),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  }) as Table;

const LABELS = { table: "table", view: "vue" };

/** What the editor offers with the cursor at the end of `doc`. */
async function complete(doc: string, catalog: SqlCatalogTable[], engine: DatabaseEngine = "postgres") {
  const completion = {
    ...toSqlSchema(catalog, engine, LABELS),
    columns: (statement: string) => columnCompletions(statement, catalog, engine),
  };
  const state = EditorState.create({ doc, extensions: sqlLanguage(engine, completion) });
  const context = new CompletionContext(state, doc.length, true);
  const options: Completion[] = [];
  for (const source of state.languageDataAt<(context: CompletionContext) => unknown>("autocomplete", doc.length)) {
    const result = (await source(context)) as { options: Completion[] } | null;
    if (result) options.push(...result.options);
  }
  return options;
}

test("the database's tables come first; the project's schema fills what the database has not said", () => {
  const catalog = mergeCatalog(
    [dbTable("customers"), dbTable("invoices"), dbTable("recent", null, "view")],
    new Map([[catalogKey({ schema: null, name: "customers" }), [dbColumn("id", "INTEGER", true)]]]),
    [
      projectTable("customers", [
        ["id", "int", true],
        ["nickname", "text"],
      ]),
      projectTable("Invoices", [["total", "numeric"]]),
      projectTable("drafts", [["id", "int", true]]),
    ],
  );
  assert.deepEqual(catalog, [
    // Described by the database: the project's extra column is not there, so it is not offered.
    { schema: null, name: "customers", kind: "table", columns: [{ name: "id", type: "INTEGER", primaryKey: true }] },
    // Not described yet: the project's columns stand in, whatever the case of the name.
    { schema: null, name: "invoices", kind: "table", columns: [{ name: "total", type: "numeric", primaryKey: false }] },
    { schema: null, name: "recent", kind: "view", columns: null },
    // Only in the project.
    { schema: null, name: "drafts", kind: "table", columns: [{ name: "id", type: "int", primaryKey: true }] },
  ]);
});

test("without an answer from the database, the project's schema is the whole catalog", () => {
  const catalog = mergeCatalog(null, new Map(), [projectTable("users", [["id", "int", true]])]);
  assert.deepEqual(
    catalog.map((table) => table.name),
    ["users"],
  );
});

test("a statement names the tables it spells out, whole words only", () => {
  const catalog = mergeCatalog([dbTable("users"), dbTable("user_roles"), dbTable("Order Items")], new Map(), []);
  const names = (statement: string) => referencedTables(statement, catalog).map((table) => table.name);
  assert.deepEqual(names("SELECT * FROM us"), []);
  assert.deepEqual(names("select * from USERS u join user_roles r on r.user_id = u.id"), ["users", "user_roles"]);
  assert.deepEqual(names('SELECT * FROM "Order Items"'), ["Order Items"]);
  assert.deepEqual(names("   "), []);
});

test("completion offers keywords, tables, and the columns of a table or of its alias", async () => {
  const catalog = mergeCatalog(
    [dbTable("customers", "public"), dbTable("Order Items", "public"), dbTable("events", "audit")],
    new Map([
      [
        catalogKey({ schema: "public", name: "customers" }),
        [dbColumn("id", "integer", true), dbColumn("name", "text")],
      ],
    ]),
    [],
  );

  const top = await complete("SELECT * FROM c", catalog);
  const customers = top.find((option) => option.label === "customers");
  // `public` is where an unqualified name is looked up: its tables are offered without it.
  assert.deepEqual(customers && [customers.type, customers.detail], ["class", "table"]);
  assert.ok(top.some((option) => option.label === "audit"));
  assert.ok(!top.some((option) => option.label === "events"));
  assert.ok(top.some((option) => option.label === "CASE" && option.type === "keyword"));
  // A name that cannot be written bare is inserted quoted.
  assert.equal(top.find((option) => option.label === "Order Items")?.apply, '"Order Items"');

  assert.deepEqual(
    (await complete("SELECT * FROM audit.", catalog)).map((option) => option.label),
    ["events"],
  );
  const aliased = await complete("SELECT * FROM customers c WHERE c.", catalog);
  assert.deepEqual(
    aliased.map((option) => [option.label, option.type, option.detail]),
    [
      ["id", "constant", "integer · pk"],
      ["name", "property", "text"],
    ],
  );
});

test("the columns of the tables a statement names are offered without their table", async () => {
  const catalog = mergeCatalog(
    [dbTable("customers"), dbTable("invoices"), dbTable("products")],
    new Map([
      [catalogKey({ schema: null, name: "customers" }), [dbColumn("id", "INTEGER", true), dbColumn("name", "TEXT")]],
      [catalogKey({ schema: null, name: "invoices" }), [dbColumn("id", "INTEGER", true), dbColumn("Total", "REAL")]],
      [catalogKey({ schema: null, name: "products" }), [dbColumn("sku", "TEXT")]],
    ]),
    [],
  );
  const columns = async (doc: string) =>
    (await complete(doc, catalog, "sqlite"))
      .filter((option) => option.type === "property" || option.type === "constant")
      .map((option) => [option.label, option.detail, option.apply]);

  assert.deepEqual(await columns("SELECT * FROM customers JOIN invoices WHERE "), [
    ["id", "INTEGER · customers, invoices", undefined],
    ["name", "TEXT · customers", undefined],
    ["Total", "REAL · invoices", '"Total"'],
  ]);
  // Nothing is named yet, and nothing where a name is not being written.
  assert.deepEqual(await columns("SELECT "), []);
  assert.deepEqual(await columns("SELECT * FROM customers WHERE name = 'na"), []);
  assert.deepEqual(await columns("SELECT * FROM customers -- na"), []);
});

test("names are quoted the engine's way, and every engine has a dialect", async () => {
  const catalog = mergeCatalog([dbTable("Order Items")], new Map(), []);
  const applied = async (engine: DatabaseEngine) =>
    (await complete("SELECT * FROM o", catalog, engine)).find((option) => option.label === "Order Items")?.apply;
  assert.equal(await applied("mysql"), "`Order Items`");
  assert.equal(await applied("bigquery"), "`Order Items`");
  assert.equal(await applied("mssql"), "[Order Items]");
  assert.equal(await applied("oracle"), '"Order Items"');
  assert.equal(await applied("sqlite"), '"Order Items"');
});
