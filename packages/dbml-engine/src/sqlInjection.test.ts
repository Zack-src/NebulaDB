import test from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@nebuladb/shared";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { generateMigrationSql, type MigrationDialect } from "./migrationGenerator.js";
import { generateRollbackSql } from "./rollbackGenerator.js";
import { projectToSql } from "./dbml.js";

/**
 * Whatever a collaborator types into the schema (names, types, defaults, notes), the SQL generated from it
 * must have the same *shape* — the same statements, in the same order — as the SQL for harmless values.
 * That SQL is run against real databases by whoever deploys: a schema editor must not be able to add a
 * statement of their own.
 */

const DIALECTS: MigrationDialect[] = ["postgres", "mysql", "sqlite", "mssql", "oracle", "bigquery"];

const HOSTILE = [
  `x"; DROP TABLE victims; --`,
  `x'; DROP TABLE victims; --`,
  "x`; DROP TABLE victims; --",
  `x]; DROP TABLE victims; --`,
  "x\nDROP TABLE victims;\n--",
  "x\r\nDROP TABLE victims;\r\n",
  "x\\'; DROP TABLE victims; --",
  "x\\\\'; DROP TABLE victims; --",
  "x*/ DROP TABLE victims; /*",
  "x\u2028DROP TABLE victims;\u2029",
  "x\u0085DROP TABLE victims;",
  "x$$; DROP TABLE victims; $$",
  "x); DROP TABLE victims; --",
];

/** Removes comments, string literals and quoted identifiers; what is left is code. */
function code(sql: string, dialect: MigrationDialect): string {
  let out = "";
  let i = 0;
  const backslash = dialect === "mysql" || dialect === "bigquery";
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (c === "#" && dialect === "mysql") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (c === "'" || c === '"' || c === "`" || (c === "[" && dialect === "mssql")) {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < sql.length) {
        if (backslash && sql[j] === "\\" && c !== "`") j += 2;
        else if (sql[j] === close && sql[j + 1] === close) j += 2;
        else if (sql[j] === close) break;
        else j++;
      }
      out += " ? ";
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The first word of each statement of the code. */
function shape(sql: string, dialect: MigrationDialect): string[] {
  return code(sql, dialect)
    .split(";")
    .map((statement) => /[A-Za-z_]+/.exec(statement)?.[0]?.toUpperCase() ?? "")
    .filter(Boolean);
}

type Slot =
  | "tableName"
  | "fieldName"
  | "type"
  | "defaultString"
  | "defaultExpression"
  | "defaultLegacy"
  | "indexName"
  | "refName"
  | "note"
  | "schemaName";
const SLOTS: Slot[] = [
  "tableName",
  "fieldName",
  "type",
  "defaultString",
  "defaultExpression",
  "defaultLegacy",
  "indexName",
  "refName",
  "note",
  "schemaName",
];

function project(slot: Slot | null, value: string): Project {
  const v = (s: Slot, fallback: string) => (s === slot ? value : fallback);
  const field = (id: string, name: string, extra: object = {}) => ({ id, name, type: "int", ...extra });
  return {
    id: "p",
    name: "p",
    tables: [
      {
        id: "t1",
        name: v("tableName", "orders"),
        schemaName: slot === "schemaName" ? value : undefined,
        note: v("note", "an order"),
        fields: [
          field("t1.id", "id", { pk: true, type: "int" }),
          field("t1.a", v("fieldName", "a"), { type: v("type", "varchar(10)"), note: v("note", "n") }),
          field(
            "t1.b",
            "b",
            slot === "defaultString"
              ? { default: value, defaultKind: "string" }
              : { default: "x", defaultKind: "string" },
          ),
          field(
            "t1.c",
            "c",
            slot === "defaultExpression"
              ? { default: value, defaultKind: "expression" }
              : { default: "now()", defaultKind: "expression" },
          ),
          field("t1.d", "d", { default: slot === "defaultLegacy" ? value : "5" }),
        ],
        indexes: [{ id: "i1", name: v("indexName", "idx_a"), fieldIds: ["t1.a"], unique: false }],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
      {
        id: "t2",
        name: "items",
        fields: [field("t2.id", "id", { pk: true }), field("t2.order", "order_id")],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
    ],
    refs: [
      {
        id: "r1",
        name: v("refName", "fk_items_order"),
        from: { tableId: "t2", fieldId: "t2.order" },
        to: { tableId: "t1", fieldId: "t1.id" },
        cardinality: "one-to-many",
      },
    ],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  } as unknown as Project;
}

const EMPTY: Project = {
  id: "p",
  name: "p",
  tables: [],
  refs: [],
  enums: [],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
} as unknown as Project;

function generate(target: Project, dialect: MigrationDialect): string[] {
  const outputs: string[] = [];
  outputs.push(generateMigrationSql(diffTargetAgainstLive(EMPTY, target), dialect));
  // And the other direction: dropping and altering what exists.
  outputs.push(generateMigrationSql(diffTargetAgainstLive(target, EMPTY), dialect));
  outputs.push(generateMigrationSql(diffTargetAgainstLive(project(null, ""), target), dialect));
  outputs.push(generateRollbackSql(diffTargetAgainstLive(EMPTY, target), dialect).sql);
  outputs.push(generateRollbackSql(diffTargetAgainstLive(project(null, ""), target), dialect).sql);
  return outputs;
}

for (const dialect of DIALECTS) {
  test(`${dialect}: no value typed into the schema adds a statement to the generated SQL`, () => {
    const problems: string[] = [];
    for (const slot of SLOTS) {
      // The same slot with a harmless value: the statements this change legitimately needs.
      const baseline = generate(project(slot, "harmless"), dialect).map((sql) => shape(sql, dialect));
      for (const value of HOSTILE) {
        let outputs: string[];
        try {
          outputs = generate(project(slot, value), dialect);
        } catch {
          continue; // Refusing to generate is a fine answer.
        }
        outputs.forEach((sql, index) => {
          const got = shape(sql, dialect);
          const want = baseline[index];
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            problems.push(
              `${slot} = ${JSON.stringify(value).slice(0, 40)} -> output #${index}: ${got.join(" ")} (expected ${want.join(" ")})`,
            );
          }
        });
      }
    }
    assert.deepEqual(problems, []);
  });
}

test("the plain SQL export has the same property for the three dialects it supports", () => {
  const problems: string[] = [];
  for (const dialect of ["postgres", "mysql", "mssql"] as const) {
    for (const slot of SLOTS) {
      const baseline = shape(projectToSql(project(slot, "harmless"), dialect), dialect as MigrationDialect);
      for (const value of HOSTILE) {
        let sql: string;
        try {
          sql = projectToSql(project(slot, value), dialect);
        } catch {
          continue;
        }
        const got = shape(sql, dialect as MigrationDialect);
        if (JSON.stringify(got) !== JSON.stringify(baseline))
          problems.push(`${dialect} ${slot} = ${JSON.stringify(value).slice(0, 40)} -> ${got.join(" ")}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
