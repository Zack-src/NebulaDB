import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdminConnectionSummary } from "@nebuladb/shared";
import type { TranslationKey } from "@/i18n/translate";
import type { SearchHit } from "@/services/searchApi";
import {
  buildGroups,
  connectionEntries,
  flattenGroups,
  localTableEntries,
  navigationTargets,
  rankEntries,
  searchEntries,
  stepIndex,
  type LocalTable,
} from "./paletteModel";

const t = (key: TranslationKey) => key;
const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id);

test("a plain member sees the top-level places and no admin tab", () => {
  const entries = navigationTargets({ isAdmin: false }, null, t);
  assert.deepEqual(ids(entries), ["view:app", "view:bases", "view:settings"]);
});

test("an instance administrator also gets every admin console tab", () => {
  const entries = navigationTargets({ isAdmin: true }, null, t);
  const admin = entries.filter((entry) => entry.id.startsWith("admin:"));
  assert.deepEqual(ids(admin), [
    "admin:users",
    "admin:teams",
    "admin:audit",
    "admin:errors",
    "admin:connections",
    "admin:environments",
    "admin:lint",
    "admin:sso",
    "admin:shareLinks",
  ]);
});

test("an open project adds its tabs first, and deployments only for those who may deploy", () => {
  const tabs = (permission: "view" | "edit" | "deploy" | "administrator") =>
    ids(navigationTargets({ isAdmin: false }, { name: "Shop", permission }, t)).filter((id) => id.startsWith("tab:"));
  assert.deepEqual(tabs("view"), ["tab:schema", "tab:history", "tab:problems", "tab:dictionary", "tab:variants"]);
  assert.deepEqual(tabs("edit"), ["tab:schema", "tab:history", "tab:problems", "tab:dictionary", "tab:variants"]);
  for (const permission of ["deploy", "administrator"] as const) {
    assert.deepEqual(tabs(permission), [
      "tab:schema",
      "tab:deployments",
      "tab:history",
      "tab:problems",
      "tab:dictionary",
      "tab:variants",
    ]);
  }
  const all = navigationTargets({ isAdmin: false }, { name: "Shop", permission: "view" }, t);
  assert.equal(all[0].id, "tab:schema");
  assert.equal(all[0].detail, "Shop");
});

test("an instance administrator does not see a deployments tab the project would hide", () => {
  const entries = navigationTargets({ isAdmin: true }, { name: "Shop", permission: "view" }, t);
  assert.ok(!ids(entries).includes("tab:deployments"));
});

test("rankEntries drops non-matches and puts prefix matches first; an empty query keeps the order", () => {
  const entries = navigationTargets({ isAdmin: true }, null, (key) => key.split(".").pop() ?? key);
  assert.deepEqual(rankEntries("", entries), entries);
  const ranked = rankEntries("env", entries);
  assert.equal(ranked[0].id, "admin:environments");
  assert.ok(!ids(ranked).includes("view:app"));
});

const tables: LocalTable[] = [
  {
    name: "orders",
    fields: [
      { name: "id", type: "int" },
      { name: "customer_id", type: "int" },
    ],
  },
  { name: "customers", fields: [{ name: "id", type: "int" }] },
];

test("localTableEntries finds tables and columns, with no server involved", () => {
  const entries = localTableEntries("cust", "p1", tables);
  assert.deepEqual(ids(entries), [
    "local:table:.customers",
    "local:field:.customers.id",
    "local:field:.orders.customer_id",
  ]);
  assert.deepEqual(entries[2].action, {
    type: "table",
    projectId: "p1",
    tableName: "orders",
    fieldName: "customer_id",
  });
  assert.deepEqual(localTableEntries("   ", "p1", tables), []);
  assert.deepEqual(localTableEntries("zzz", "p1", tables), []);
});

test("localTableEntries does not match a column's type", () => {
  assert.deepEqual(localTableEntries("int", "p1", tables), []);
});

const hit = (overrides: Partial<SearchHit>): SearchHit => ({
  projectId: "p2",
  projectName: "Other",
  kind: "table",
  tableName: "invoices",
  rank: 1,
  ...overrides,
});

test("searchEntries maps hits to actions and keeps the server order", () => {
  const entries = searchEntries(
    [
      hit({}),
      hit({ kind: "field", fieldName: "total" }),
      hit({ kind: "enum", tableName: undefined, enumName: "status" }),
    ],
    null,
  );
  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.kind, entry.action.type]),
    [
      ["invoices", "table", "table"],
      ["invoices.total", "field", "table"],
      ["status", "enum", "project"],
    ],
  );
});

test("searchEntries leaves out the open project's tables and columns (answered locally) but keeps its enums", () => {
  const entries = searchEntries(
    [
      hit({ projectId: "p1" }),
      hit({ projectId: "p1", kind: "field", fieldName: "x" }),
      hit({ projectId: "p1", kind: "enum", tableName: undefined, enumName: "status" }),
      hit({ projectId: "p2" }),
    ],
    "p1",
  );
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ["status", "invoices"],
  );
});

const connection = (overrides: Partial<AdminConnectionSummary>) =>
  ({
    id: "c1",
    name: "Prod",
    engine: "postgres",
    environment: "production",
    host: "db.example",
    tags: [],
    ...overrides,
  }) as AdminConnectionSummary;

test("connectionEntries needs a query and jumps to the connections tab with the connection id", () => {
  const list = [connection({}), connection({ id: "c2", name: "Staging", engine: "mysql", environment: "staging" })];
  assert.deepEqual(connectionEntries("", list), []);
  const entries = connectionEntries("stag", list);
  assert.deepEqual(ids(entries), ["connection:c2"]);
  assert.deepEqual(entries[0].action, { type: "admin", section: "connections", connectionId: "c2" });
  assert.equal(entries[0].detail, "mysql · staging");
});

test("buildGroups lists only the places for an empty query", () => {
  const groups = buildGroups({
    query: "",
    navigation: navigationTargets({ isAdmin: true }, null, t),
    localTables: [],
    connections: connectionEntries("prod", [connection({})]),
    hits: searchEntries([hit({})], null),
  });
  assert.deepEqual(
    groups.map((group) => group.id),
    ["go"],
  );
});

test("buildGroups puts the open project's tables first, then places, connections and search; empty groups vanish", () => {
  const groups = buildGroups({
    query: "co",
    navigation: navigationTargets({ isAdmin: true }, null, (key) => key),
    localTables: localTableEntries("co", "p1", tables),
    connections: connectionEntries("co", [connection({ name: "Core" })]),
    hits: searchEntries([hit({ tableName: "contacts" })], "p1").concat(
      searchEntries([hit({ tableName: "contacts" })], null),
    ),
  });
  assert.deepEqual(
    groups.map((group) => group.id),
    ["tables", "go", "connections", "search"],
  );
  assert.equal(flattenGroups(groups)[0].group, "tables");
  assert.deepEqual(buildGroups({ query: "co", navigation: [], localTables: [], connections: [], hits: [] }), []);
});

test("stepIndex wraps in both directions and reports an empty list", () => {
  assert.equal(stepIndex(0, 1, 3), 1);
  assert.equal(stepIndex(2, 1, 3), 0);
  assert.equal(stepIndex(0, -1, 3), 2);
  assert.equal(stepIndex(0, 1, 0), -1);
});
