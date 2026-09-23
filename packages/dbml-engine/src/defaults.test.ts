import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project } from "@athanordb/shared";
import { parseDbml, projectToSql, toProject } from "./dbml.js";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { formatColumnDef, generateMigrationSql } from "./migrationGenerator.js";
import { projectToDbml } from "./serialize.js";

/**
 * Column defaults keep what DBML says they are. `` `now()` `` is an
 * expression, `'now()'` is a string that happens to look like one — the two
 * used to collapse into the same bare string, and the DBML panel then
 * rewrote every expression as a quoted string on its next resync.
 */

const SOURCE = `Table t {
  id integer [pk]
  created_at timestamp [default: \`now()\`]
  literal_call varchar [default: 'now()']
  status varchar [default: 'draft']
  retries integer [default: 3]
  active boolean [default: true]
  note varchar [default: null]
}
`;

function parse(source: string): Project {
  return toProject(parseDbml(source), "p", source);
}

function fieldsByName(project: Project): Record<string, Field> {
  return Object.fromEntries(project.tables[0].fields.map((f) => [f.name, f]));
}

test("each DBML default spelling is parsed with its kind", () => {
  const f = fieldsByName(parse(SOURCE));
  assert.deepEqual(
    Object.fromEntries(Object.entries(f).map(([name, field]) => [name, [field.default, field.defaultKind]])),
    {
      id: [undefined, undefined],
      created_at: ["now()", "expression"],
      literal_call: ["now()", "string"],
      status: ["draft", "string"],
      retries: ["3", "number"],
      active: ["true", "boolean"],
      note: ["null", "boolean"],
    },
  );
});

test("DBML round trip keeps expressions as expressions and strings as strings", () => {
  const dbml = projectToDbml(parse(SOURCE));
  assert.match(dbml, /created_at\s+timestamp\s+\[default: `now\(\)`\]/);
  assert.match(dbml, /literal_call\s+varchar\s+\[default: 'now\(\)'\]/);
  assert.deepEqual(fieldsByName(parse(dbml)), fieldsByName(parse(SOURCE)));
  const again = fieldsByName(parse(projectToDbml(parse(dbml))));
  assert.equal(again.created_at.defaultKind, "expression");
  assert.equal(again.literal_call.defaultKind, "string");
});

test("SQL export and migration SQL: an expression unquoted, a string quoted even when it looks like a call", () => {
  const project = parse(SOURCE);
  const exported = projectToSql(project, "postgres");
  assert.match(exported, /"created_at" timestamp DEFAULT \(?now\(\)\)?/);
  assert.match(exported, /"literal_call" varchar DEFAULT 'now\(\)'/);

  const empty: Project = { ...project, tables: [], refs: [] };
  const create = generateMigrationSql(diffTargetAgainstLive(empty, project), "postgres");
  assert.match(create, /"created_at" timestamp DEFAULT now\(\)/);
  assert.match(create, /"literal_call" varchar DEFAULT 'now\(\)'/);
  assert.match(create, /"status" varchar DEFAULT 'draft'/);
  assert.match(create, /"retries" integer DEFAULT 3/);
  assert.match(create, /"active" boolean DEFAULT TRUE/);
});

test("ALTER … SET DEFAULT keeps an expression unquoted (it used to be quoted as a string)", () => {
  const before = parse("Table t {\n  id integer [pk]\n  created_at timestamp\n}\n");
  const after = parse("Table t {\n  id integer [pk]\n  created_at timestamp [default: `now()`]\n}\n");
  const sql = generateMigrationSql(diffTargetAgainstLive(before, after), "postgres");
  assert.match(sql, /ALTER COLUMN "created_at" SET DEFAULT now\(\);/);
});

test("expression → string with the same text is a change; data without a kind is not flagged", () => {
  const expr = parse("Table t {\n  id integer [pk]\n  c varchar [default: `now()`]\n}\n");
  const str = parse("Table t {\n  id integer [pk]\n  c varchar [default: 'now()']\n}\n");
  const change = diffTargetAgainstLive(expr, str).tables[0]?.fields.find((f) => f.name === "c");
  assert.equal(change?.defaultChanged, true);

  const legacy: Project = {
    ...expr,
    tables: expr.tables.map((t) => ({ ...t, fields: t.fields.map(({ defaultKind: _kind, ...f }) => f) })),
  };
  assert.equal(diffTargetAgainstLive(legacy, expr).hasChanges, false);
});

test("a default with no kind (older data, typed in the field editor) is still guessed as before", () => {
  const field: Field = { id: "f", name: "at", type: "timestamp", default: "now()" };
  assert.equal(formatColumnDef(field, "postgres"), `"at" timestamp DEFAULT now()`);
  assert.equal(formatColumnDef({ ...field, default: "draft" }, "postgres"), `"at" timestamp DEFAULT 'draft'`);
});

test("older data without a kind: an obvious call is written back as an expression, so the next parse keeps it one", () => {
  const legacy = parse("Table t {\n  id integer [pk]\n  at timestamp\n  s varchar\n}\n");
  legacy.tables[0].fields[1] = { ...legacy.tables[0].fields[1], default: "now()" };
  legacy.tables[0].fields[2] = { ...legacy.tables[0].fields[2], default: "draft" };
  const dbml = projectToDbml(legacy);
  assert.match(dbml, /at\s+timestamp\s+\[default: `now\(\)`\]/);
  assert.match(dbml, /s\s+varchar\s+\[default: 'draft'\]/);
  assert.equal(fieldsByName(parse(dbml)).at.defaultKind, "expression");
});
