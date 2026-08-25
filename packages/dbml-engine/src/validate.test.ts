import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Ref, Table } from "@athanordb/shared";
import { validateProject } from "./validate.js";

function table(id: string, name: string, fieldNames: string[] = ["id"]): Table {
  return {
    id,
    name,
    // The `id` field is the PK by convention in every fixture below — tests
    // that actually care about the missing-PK/type-mismatch checks build
    // their own table literal instead of going through this helper, so the
    // rest of the suite (duplicates, dangling refs, cycles) isn't drowned in
    // an incidental "no primary key" warning it isn't testing for.
    fields: fieldNames.map((n, i) => ({ id: `${id}-f${i}`, name: n, type: "int", pk: n === "id" })),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

function ref(
  id: string,
  from: [string, string],
  to: [string, string],
  cardinality: Ref["cardinality"] = "one-to-many",
): Ref {
  return { id, from: { tableId: from[0], fieldId: from[1] }, to: { tableId: to[0], fieldId: to[1] }, cardinality };
}

function project(tables: Table[], refs: Ref[] = []): Project {
  return { id: "p1", name: "Test", tables, refs, enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

test("clean schema produces no issues", () => {
  const users = table("t1", "users");
  const posts = table("t2", "posts", ["id", "user_id"]);
  const issues = validateProject(project([users, posts], [ref("r1", ["t2", "t2-f1"], ["t1", "t1-f0"])]));
  assert.deepEqual(issues, []);
});

test("duplicate table names flagged as error", () => {
  const issues = validateProject(project([table("t1", "users"), table("t2", "users")]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.match(issues[0].message, /Duplicate table name "users"/);
});

test("duplicate field names within a table flagged as error", () => {
  const t = table("t1", "users", ["id", "email", "email"]);
  const issues = validateProject(project([t]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].tableId, "t1");
  assert.match(issues[0].message, /Duplicate field name "email"/);
});

test("ref pointing at a nonexistent table is a missing-FK-target error", () => {
  const users = table("t1", "users");
  const dangling = ref("r1", ["t1", "t1-f0"], ["ghost-table", "ghost-field"]);
  const issues = validateProject(project([users], [dangling]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.match(issues[0].message, /target table not found/);
});

test("ref pointing at a real table but nonexistent field is a missing-FK-target error", () => {
  const users = table("t1", "users");
  const posts = table("t2", "posts", ["id", "user_id"]);
  const dangling = ref("r1", ["t2", "t2-f1"], ["t1", "no-such-field"]);
  const issues = validateProject(project([users, posts], [dangling]));
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /target field not found in "users"/);
});

test("self-referencing table (e.g. manager_id -> own id) is NOT flagged as circular", () => {
  const employees = table("t1", "employees", ["id", "manager_id"]);
  const selfRef = ref("r1", ["t1", "t1-f1"], ["t1", "t1-f0"]);
  const issues = validateProject(project([employees], [selfRef]));
  assert.deepEqual(issues, [], "self-refs are a common, valid pattern — not a modeling mistake worth flagging");
});

test("circular reference among 3 distinct tables flagged as warning", () => {
  const a = table("t1", "a", ["id", "b_id"]);
  const b = table("t2", "b", ["id", "c_id"]);
  const c = table("t3", "c", ["id", "a_id"]);
  const refs = [
    ref("r1", ["t1", "t1-f1"], ["t2", "t2-f0"]),
    ref("r2", ["t2", "t2-f1"], ["t3", "t3-f0"]),
    ref("r3", ["t3", "t3-f1"], ["t1", "t1-f0"]),
  ];
  const issues = validateProject(project([a, b, c], refs));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.match(issues[0].message, /Circular reference/);
});

test("two-table mutual cycle flagged as warning", () => {
  const a = table("t1", "a", ["id", "b_id"]);
  const b = table("t2", "b", ["id", "a_id"]);
  const refs = [ref("r1", ["t1", "t1-f1"], ["t2", "t2-f0"]), ref("r2", ["t2", "t2-f1"], ["t1", "t1-f0"])];
  const issues = validateProject(project([a, b], refs));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
});

test("table with no field marked pk and no pk index is flagged as a warning", () => {
  // A pure junction/join table — two FK columns, neither is `pk` — is the
  // most common real-world case of this (see DeepDetect's ~24 join tables).
  const t: Table = {
    id: "t1",
    name: "criteria_theme_list",
    fields: [
      { id: "t1-f0", name: "id_theme", type: "int" },
      { id: "t1-f1", name: "id_criteria", type: "int" },
    ],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
  const issues = validateProject(project([t]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].tableId, "t1");
  assert.match(issues[0].message, /has no primary key/);
});

test("a composite pk declared as a table index counts as having a pk", () => {
  const t: Table = {
    id: "t1",
    name: "criteria_theme_list",
    fields: [
      { id: "t1-f0", name: "id_theme", type: "int" },
      { id: "t1-f1", name: "id_criteria", type: "int" },
    ],
    indexes: [{ id: "idx1", fieldIds: ["t1-f0", "t1-f1"], pk: true }],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
  assert.deepEqual(validateProject(project([t])), []);
});

test("ref whose two sides have different base column types is flagged as a warning", () => {
  const kci = table("t1", "kci", ["id", "id_kci_type"]);
  kci.fields[1].type = "decimal";
  const kciType = table("t2", "kci_type", ["id"]);
  const issues = validateProject(project([kci, kciType], [ref("r1", ["t1", "t1-f1"], ["t2", "t2-f0"])]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].refId, "r1");
  assert.match(issues[0].message, /type mismatch/i);
});

test("ref sides differing only in precision/args (decimal(10,2) vs decimal) are not flagged", () => {
  const a = table("t1", "a", ["id", "amount"]);
  a.fields[1].type = "decimal(10,2)";
  const b = table("t2", "b", ["id"]);
  b.fields[0].type = "decimal";
  const issues = validateProject(project([a, b], [ref("r1", ["t1", "t1-f1"], ["t2", "t2-f0"])]));
  assert.deepEqual(issues, []);
});
