import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Table } from "@athanordb/shared";
import { parseVariableValues, resolveVariables, variablesUsed } from "./variables.js";
import { parseDbml, toProject } from "./dbml.js";
import { projectToDbml } from "./serialize.js";
import { lintProject } from "./lint.js";

function table(id: string, name: string, schemaName?: string): Table {
  return {
    id,
    name,
    schemaName,
    note: "Described.",
    fields: [
      { id: `${id}-id`, name: "id", type: "integer", pk: true },
      { id: `${id}-c`, name: "created_at", type: "timestamp" },
      { id: `${id}-u`, name: "updated_at", type: "timestamp" },
    ],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

function project(tables: Table[]): Project {
  return { id: "p1", name: "Shop", tables, refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

const shop = project([
  table("t1", "{{table_prefix}}orders", "{{schema}}"),
  table("t2", "{{ table_prefix }}customers", "{{schema}}"),
  table("t3", "settings"),
]);

test("the variables a schema uses are found in table names and schemas", () => {
  assert.deepEqual(variablesUsed(shop), ["schema", "table_prefix"]);
  assert.deepEqual(variablesUsed(project([table("t3", "settings")])), []);
});

test("a stage's values replace the placeholders; ids and everything else stay", () => {
  const resolved = resolveVariables(shop, { schema: "sales", table_prefix: "pp_" });
  assert.deepEqual(
    resolved.project.tables.map((t) => [t.id, t.schemaName, t.name]),
    [
      ["t1", "sales", "pp_orders"],
      ["t2", "sales", "pp_customers"],
      ["t3", undefined, "settings"],
    ],
  );
  assert.deepEqual([resolved.missing, resolved.unnamed, resolved.collisions], [[], [], []]);
  // The table without a placeholder is the very same object; the input is untouched.
  assert.equal(resolved.project.tables[2], shop.tables[2]);
  assert.equal(shop.tables[0].name, "{{table_prefix}}orders");

  // No prefix and the default schema on another stage.
  const bare = resolveVariables(shop, { schema: "", table_prefix: "" });
  assert.deepEqual(
    bare.project.tables.map((t) => [t.schemaName, t.name]),
    [
      [undefined, "orders"],
      [undefined, "customers"],
      [undefined, "settings"],
    ],
  );
});

test("nothing is guessed: a variable without a value is reported, and so is what resolution breaks", () => {
  const missing = resolveVariables(shop, { schema: "sales" });
  assert.deepEqual(missing.missing, ["table_prefix"]);
  assert.equal(missing.project.tables[0].name, "{{table_prefix}}orders");

  const clash = resolveVariables(project([table("a", "{{p}}users"), table("b", "users"), table("c", "{{p}}")]), {
    p: "",
  });
  assert.deepEqual(clash.collisions, ["users"]);
  assert.deepEqual(clash.unnamed, ["{{p}}"]);

  // A schema without placeholders is returned as it is.
  const plain = project([table("t3", "settings")]);
  assert.equal(resolveVariables(plain, {}).project, plain);
});

test("values from outside are checked: identifier fragments only", () => {
  assert.deepEqual(parseVariableValues({ schema: "sales", table_prefix: "" }), { schema: "sales", table_prefix: "" });
  assert.equal(parseVariableValues(null), null);
  assert.equal(parseVariableValues(["a"]), null);
  assert.equal(parseVariableValues({ "bad name": "x" }), null);
  assert.equal(parseVariableValues({ schema: 3 }), null);
  assert.equal(parseVariableValues({ schema: 'x"; DROP TABLE users; --' }), null);
  assert.equal(parseVariableValues({ schema: "a b" }), null);
});

test("placeholders survive the DBML text and are not a naming fault", () => {
  const back = toProject(parseDbml(projectToDbml(shop)), "Shop");
  assert.deepEqual(variablesUsed(back), ["schema", "table_prefix"]);
  assert.deepEqual(
    back.tables.map((t) => [t.schemaName, t.name]).sort(),
    [
      [undefined, "settings"],
      ["{{schema}}", "{{ table_prefix }}customers"],
      ["{{schema}}", "{{table_prefix}}orders"],
    ].sort(),
  );
  assert.deepEqual(
    lintProject(shop).filter((finding) => finding.ruleId === "naming-snake-case"),
    [],
  );
});
