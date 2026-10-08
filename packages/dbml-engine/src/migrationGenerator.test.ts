import test from "node:test";
import assert from "node:assert/strict";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import {
  formatColumnDef,
  generateCreateTable,
  generateMigrationSql,
  schemaForDialect,
  translateDefaultExpression,
} from "./migrationGenerator.js";
import { generateRollbackSql } from "./rollbackGenerator.js";
import type { Project, Ref, Table } from "@nebuladb/shared";

interface ShorthandField {
  name: string;
  type?: string;
  pk?: boolean;
  notNull?: boolean;
  default?: string;
}

interface ShorthandTable {
  name: string;
  fields?: ShorthandField[];
}

function makeSimpleProject(tables: ShorthandTable[] = []): Project {
  return {
    id: "p1",
    name: "Test",
    tables: tables.map((t) => ({
      id: t.name,
      name: t.name,
      fields: (t.fields || []).map((f) => ({
        id: `${t.name}.${f.name}`,
        name: f.name,
        type: f.type || "text",
        pk: f.pk,
        notNull: f.notNull,
        default: f.default,
      })),
      indexes: [],
      position: { x: 0, y: 0 },
      detailLevel: "standard" as const,
    })),
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
}

test("generateMigrationSql generates PostgreSQL DDL with transactions and resolutions", () => {
  const live = makeSimpleProject([
    {
      name: "users",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "old_column", type: "text" },
        { name: "count", type: "int" },
      ],
    },
  ]);

  const target = makeSimpleProject([
    {
      name: "users",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "count", type: "text" }, // altered type
        { name: "created_at", type: "timestamptz", notNull: true }, // added column
      ],
    },
    {
      name: "posts",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "title", type: "text", notNull: true },
      ],
    },
  ]);

  const diff = diffTargetAgainstLive(live, target);

  // Scenario: user chose to keep old_column in DB instead of dropping it, and provide default for created_at
  const sql = generateMigrationSql(diff, "postgres", {
    "column:users.old_column": { strategy: "KEEP_IN_DB" },
    "column:users.count": { strategy: "FORCE_CAST" },
    "column:users.created_at": { strategy: "BACKFILL_DEFAULT", value: "NOW()" },
  });

  assert.ok(sql.startsWith("BEGIN;"));
  assert.ok(sql.includes('CREATE TABLE "posts"'));
  assert.ok(sql.includes('ALTER TABLE "users" ADD COLUMN "created_at" timestamptz NOT NULL DEFAULT NOW();'));
  assert.ok(sql.includes('ALTER TABLE "users" ALTER COLUMN "count" TYPE text USING "count"::text;'));
  assert.ok(sql.includes('-- Kept column "users"."old_column"'));
  assert.ok(sql.endsWith("COMMIT;"));
});

test("generateMigrationSql handles DROP TABLE confirmed vs kept", () => {
  const live = makeSimpleProject([{ name: "t1", fields: [{ name: "id", type: "int" }] }]);
  const target = makeSimpleProject([]);

  const diff = diffTargetAgainstLive(live, target);

  // Confirmed drop
  const sqlDrop = generateMigrationSql(diff, "postgres", {
    "table:t1": { strategy: "DROP_DATA_CONFIRMED" },
  });
  assert.ok(sqlDrop.includes('DROP TABLE IF EXISTS "t1" CASCADE;'));

  // Kept drop
  const sqlKeep = generateMigrationSql(diff, "postgres", {
    "table:t1": { strategy: "KEEP_IN_DB" },
  });
  assert.ok(sqlKeep.includes('-- Kept table "t1"'));
});

/** A brand-new FK from `posts.author_id` -> `users.id`, target project only (empty live) so the ref diffs as "added". */
function makeProjectWithRef(onDelete?: Ref["onDelete"], onUpdate?: Ref["onUpdate"]): Project {
  const project = makeSimpleProject([
    { name: "users", fields: [{ name: "id", type: "int", pk: true }] },
    {
      name: "posts",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "author_id", type: "int" },
      ],
    },
  ]);
  project.refs = [
    {
      id: "ref-1",
      from: { tableId: "posts", fieldId: "posts.author_id" },
      to: { tableId: "users", fieldId: "users.id" },
      cardinality: "one-to-many",
      onDelete,
      onUpdate,
    },
  ];
  return project;
}

test("generateMigrationSql emits ON DELETE/ON UPDATE for postgres/mysql when the ref sets them", () => {
  const empty = makeSimpleProject([]);
  const target = makeProjectWithRef("cascade", "set null");
  const diff = diffTargetAgainstLive(empty, target);

  const pgSql = generateMigrationSql(diff, "postgres");
  assert.ok(
    pgSql.includes('FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE SET NULL;'),
  );

  const mysqlSql = generateMigrationSql(diff, "mysql");
  assert.ok(
    mysqlSql.includes("FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE SET NULL;"),
  );
});

test("generateMigrationSql maps mssql's unsupported RESTRICT to NO ACTION", () => {
  const empty = makeSimpleProject([]);
  const target = makeProjectWithRef("restrict", undefined);
  const diff = diffTargetAgainstLive(empty, target);

  const sql = generateMigrationSql(diff, "mssql");
  assert.ok(sql.includes("ON DELETE NO ACTION"));
  assert.ok(!sql.includes("RESTRICT"));
});

test("generateMigrationSql only emits ON DELETE CASCADE/SET NULL for oracle, dropping ON UPDATE and unsupported actions entirely", () => {
  const empty = makeSimpleProject([]);

  const cascadeSql = generateMigrationSql(
    diffTargetAgainstLive(empty, makeProjectWithRef("cascade", "cascade")),
    "oracle",
  );
  assert.ok(cascadeSql.includes('REFERENCES "users" ("id") ON DELETE CASCADE;'));
  assert.ok(!cascadeSql.includes("ON UPDATE"));

  const restrictSql = generateMigrationSql(
    diffTargetAgainstLive(empty, makeProjectWithRef("restrict", undefined)),
    "oracle",
  );
  assert.ok(restrictSql.includes('REFERENCES "users" ("id");'));
  assert.ok(!restrictSql.includes("ON DELETE"));
});

test("generateMigrationSql repairs a decimal written with a dot between precision and scale", () => {
  const target = makeSimpleProject([
    {
      name: "results",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "typo", type: "decimal(18.6)" },
        { name: "right", type: "decimal(18,6)" },
        { name: "added", type: "varchar(255)" },
      ],
    },
  ]);
  const diff = diffTargetAgainstLive(makeSimpleProject([]), target);

  for (const dialect of ["postgres", "mysql", "mssql"] as const) {
    const sql = generateMigrationSql(diff, dialect);
    assert.ok(!sql.includes("18.6"), `${dialect}: the dotted form must not reach the database`);
    assert.equal(sql.match(/\(18,6\)/g)?.length, 2, `${dialect}: both columns end up as (18,6)`);
    assert.ok(/255/.test(sql), `${dialect}: other types are left alone`);
  }
});

test("generateCreateTable makes an increment column an identity, as the SQL export does", () => {
  const table: Table = {
    id: "t",
    name: "t",
    fields: [
      { id: "t.id", name: "id", type: "int", pk: true, increment: true },
      { id: "t.label", name: "label", type: "varchar(50)", notNull: true },
    ],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
  assert.ok(generateCreateTable(table, "mssql").includes("[id] int IDENTITY(1,1) PRIMARY KEY"));
  assert.ok(generateCreateTable(table, "postgres").includes(`"id" int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`));
  assert.ok(generateCreateTable(table, "mysql").includes("`id` int PRIMARY KEY AUTO_INCREMENT"));
  assert.ok(
    generateCreateTable(table, "oracle").includes(`"id" number(10) GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`),
  );
  // SQLite numbers an INTEGER PRIMARY KEY by itself.
  assert.ok(generateCreateTable(table, "sqlite").includes(`"id" int PRIMARY KEY`));

  // A default cannot sit on a column the engine numbers.
  const withDefault = { ...table.fields[0], default: "0" };
  assert.equal(
    formatColumnDef(withDefault, "mssql", undefined, { identity: true }),
    "[id] int IDENTITY(1,1) PRIMARY KEY",
  );
  // Adding or altering a column never asks for an identity.
  assert.equal(formatColumnDef(table.fields[0], "mssql"), "[id] int PRIMARY KEY");
});

test("generateMigrationSql writes GoogleSQL for BigQuery: its types, unenforced keys, no transaction", () => {
  const target = makeProjectWithRef("cascade", "cascade");
  target.tables[1].fields.push(
    { id: "posts.title", name: "title", type: "varchar(255)", notNull: true },
    { id: "posts.body", name: "body", type: "varchar(max)" },
    { id: "posts.published", name: "published", type: "bit" },
    { id: "posts.created", name: "created", type: "datetime2", default: "GETDATE()", defaultKind: "expression" },
    { id: "posts.slug", name: "slug", type: "varchar(80)", unique: true },
  );
  const diff = diffTargetAgainstLive(makeSimpleProject([]), target);
  const sql = generateMigrationSql(diff, "bigquery");

  assert.ok(!/\b(BEGIN|COMMIT)\b/.test(sql), "BigQuery runs no DDL in a transaction");
  assert.ok(sql.includes("`title` STRING(255) NOT NULL"));
  assert.ok(sql.includes("`body` STRING,"), "varchar(max) is an unbounded STRING");
  assert.ok(sql.includes("`published` BOOL"));
  assert.ok(sql.includes("`created` DATETIME DEFAULT CURRENT_DATETIME()"), "the default follows the column's type");
  assert.ok(sql.includes("`slug` STRING(80)") && !sql.includes("UNIQUE"), "BigQuery has no unique constraint");
  assert.ok(sql.includes("PRIMARY KEY (`id`) NOT ENFORCED"));
  assert.ok(!sql.includes("`id` int PRIMARY KEY"), "the key is a constraint of the table, not of the column");
  assert.ok(sql.includes("FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) NOT ENFORCED;"));
  assert.ok(!sql.includes("ON DELETE") && !sql.includes("ON UPDATE"), "an unenforced key has no action");

  const rollback = generateRollbackSql(diff, "bigquery").sql;
  assert.ok(!/\b(BEGIN|COMMIT)\b/.test(rollback));
  assert.ok(rollback.includes("DROP TABLE IF EXISTS `posts`;"));
});

test("an increment column gets no clause on BigQuery, which numbers nothing", () => {
  const field = { id: "t.id", name: "id", type: "int", pk: true, increment: true };
  assert.equal(formatColumnDef(field, "bigquery", undefined, { identity: true }), "`id` int NOT NULL");
});

test("translateDefaultExpression rewrites only a current-time default the target does not read", () => {
  assert.equal(translateDefaultExpression("GETDATE()", "mssql", "datetime2"), "GETDATE()");
  assert.equal(translateDefaultExpression("GETDATE()", "postgres", "timestamp"), "CURRENT_TIMESTAMP");
  assert.equal(translateDefaultExpression("(getdate())", "mysql", "datetime"), "CURRENT_TIMESTAMP");
  assert.equal(translateDefaultExpression("now()", "postgres", "timestamp"), "now()");
  assert.equal(translateDefaultExpression("now()", "mssql", "datetime2"), "GETDATE()");
  assert.equal(translateDefaultExpression("CURRENT_TIMESTAMP", "sqlite", "datetime"), "CURRENT_TIMESTAMP");
  assert.equal(translateDefaultExpression("GETDATE()", "bigquery", "DATETIME"), "CURRENT_DATETIME()");
  assert.equal(translateDefaultExpression("now()", "bigquery", "TIMESTAMP"), "CURRENT_TIMESTAMP()");
  assert.equal(translateDefaultExpression("CURRENT_TIMESTAMP", "bigquery", "date"), "CURRENT_DATE()");
  // Anything that is not "now" is nobody's to rewrite.
  assert.equal(translateDefaultExpression("'draft'", "bigquery", "STRING"), "'draft'");
  assert.equal(translateDefaultExpression("gen_random_uuid()", "mssql", "uniqueidentifier"), "gen_random_uuid()");
});

test("a relation from a table to itself is left out of what goes to BigQuery, and only there", () => {
  const project = makeProjectWithRef();
  project.tables[0].fields.push({ id: "users.manager_id", name: "manager_id", type: "int" });
  project.refs.push({
    id: "ref-self",
    from: { tableId: "users", fieldId: "users.manager_id" },
    to: { tableId: "users", fieldId: "users.id" },
    cardinality: "one-to-many",
  });

  project.tables[1].fields.push({ id: "posts.slug", name: "slug", type: "varchar(80)", unique: true });
  project.tables[1].indexes.push({ id: "idx", fieldIds: ["posts.author_id"] });

  assert.equal(schemaForDialect(project, "postgres"), project);
  const held = schemaForDialect(project, "bigquery");
  assert.equal(
    held.tables[1].fields.find((field) => field.name === "slug")?.unique,
    false,
    "no unique constraint there",
  );
  assert.deepEqual(held.tables[1].indexes, [], "nor any index");
  assert.deepEqual(
    held.refs.map((ref) => ref.id),
    ["ref-1"],
  );
  assert.equal(
    generateMigrationSql(diffTargetAgainstLive(makeSimpleProject([]), held), "bigquery").match(/FOREIGN KEY/g)?.length,
    1,
  );

  // A diff that still carries one says why it is not declared instead of sending SQL BigQuery refuses.
  const raw = generateMigrationSql(diffTargetAgainstLive(makeSimpleProject([]), project), "bigquery");
  assert.equal(raw.match(/ADD CONSTRAINT/g)?.length, 1);
  assert.ok(raw.includes("-- BigQuery refuses a foreign key from a table to itself"));
});
