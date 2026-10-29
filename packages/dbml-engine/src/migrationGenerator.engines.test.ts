import test from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@nebuladb/shared";
import { planRiskProbes } from "./deploymentProbes.js";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { formatColumnDef, generateCreateTable, generateMigrationSql, schemaForDialect } from "./migrationGenerator.js";
import { generateRollbackSql } from "./rollbackGenerator.js";

interface Col {
  name: string;
  type: string;
  pk?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: string;
}

function project(tables: { name: string; fields: Col[]; indexes?: string[][] }[] = []): Project {
  return {
    id: "p1",
    name: "Test",
    tables: tables.map((t) => ({
      id: t.name,
      name: t.name,
      fields: t.fields.map((f) => ({ id: `${t.name}.${f.name}`, ...f })),
      indexes: (t.indexes ?? []).map((columns, i) => ({
        id: `${t.name}.i${i}`,
        fieldIds: columns.map((c) => `${t.name}.${c}`),
      })),
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

const USERS = {
  name: "users",
  fields: [
    { name: "id", type: "int", pk: true },
    { name: "name", type: "varchar(255)", notNull: true },
    { name: "email", type: "varchar(255)", unique: true },
    { name: "balance", type: "decimal(18,6)" },
  ],
};

const commandsOf = (script: string) =>
  script
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("--"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

test("ClickHouse: a table is a MergeTree ordered by its key, columns are not null only when said so", () => {
  const sql = generateCreateTable(project([USERS]).tables[0]!, "clickhouse");
  assert.match(sql, /^CREATE TABLE `users` \(/);
  assert.match(sql, /`id` Int32,/);
  assert.match(sql, /`name` String,/);
  assert.match(sql, /`email` Nullable\(String\),/);
  assert.match(sql, /`balance` Nullable\(Decimal\(18,6\)\)\n\)/);
  assert.match(sql, /\)\nENGINE = MergeTree\nORDER BY \(`id`\);$/);
  assert.doesNotMatch(sql, /PRIMARY KEY|UNIQUE/);
});

test("ClickHouse: a table without a key is ordered by nothing", () => {
  const sql = generateCreateTable(
    project([{ name: "log", fields: [{ name: "line", type: "text" }] }]).tables[0]!,
    "clickhouse",
  );
  assert.match(sql, /ORDER BY tuple\(\);$/);
});

test("ClickHouse: a composite key becomes the sorting key", () => {
  const table = project([
    {
      name: "link",
      fields: [
        { name: "a", type: "int" },
        { name: "b", type: "int" },
      ],
    },
  ]).tables[0]!;
  table.indexes.push({ id: "pk", fieldIds: ["link.a", "link.b"], pk: true });
  assert.match(generateCreateTable(table, "clickhouse"), /ORDER BY \(`a`, `b`\);$/);
});

test("ClickHouse: the columns of a composite key are not nullable, as its sorting key refuses them", () => {
  const table = project([
    {
      name: "link",
      fields: [
        { name: "a", type: "int" },
        { name: "b", type: "int" },
        { name: "note", type: "text" },
      ],
    },
  ]).tables[0]!;
  table.indexes.push({ id: "pk", fieldIds: ["link.a", "link.b"], pk: true });
  const sql = generateCreateTable(table, "clickhouse");
  assert.match(sql, /`a` Int32,/);
  assert.match(sql, /`b` Int32,/);
  assert.match(sql, /`note` Nullable\(String\)/);
});

test("ClickHouse: a default is written after the type, and the identity clause is dropped", () => {
  const field = project([{ name: "t", fields: [{ name: "n", type: "int", notNull: true, default: "5" }] }]).tables[0]!
    .fields[0]!;
  assert.equal(formatColumnDef(field, "clickhouse", "Int32"), "`n` Int32 DEFAULT 5");
});

test("ClickHouse: no foreign key, no unique, no index; no transaction around the script", () => {
  const canvas = project([
    USERS,
    {
      name: "orders",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "user_id", type: "int" },
      ],
      indexes: [["user_id"]],
    },
  ]);
  canvas.refs.push({
    id: "r1",
    from: { tableId: "orders", fieldId: "orders.user_id" },
    to: { tableId: "users", fieldId: "users.id" },
    cardinality: "one-to-many",
  });
  const held = schemaForDialect(canvas, "clickhouse");
  assert.deepEqual(held.refs, []);
  assert.ok(held.tables.every((t) => t.fields.every((f) => !f.unique)));
  const sql = generateMigrationSql(diffTargetAgainstLive(project(), held), "clickhouse");
  assert.doesNotMatch(sql, /BEGIN|COMMIT|FOREIGN KEY|UNIQUE/);
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 2);
});

test("ClickHouse: columns are added, dropped and changed with ALTER TABLE", () => {
  const live = project([
    {
      name: "t",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "old", type: "text" },
        { name: "n", type: "int" },
      ],
    },
  ]);
  const canvas = project([
    {
      name: "t",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "n", type: "bigint", notNull: true },
        { name: "added", type: "text" },
      ],
    },
  ]);
  const sql = generateMigrationSql(diffTargetAgainstLive(live, canvas), "clickhouse");
  assert.match(sql, /ALTER TABLE `t` ADD COLUMN `added` Nullable\(String\);/);
  assert.match(sql, /ALTER TABLE `t` DROP COLUMN `old`;/);
  assert.match(sql, /ALTER TABLE `t` MODIFY COLUMN `n` Int64;/);
});

test("MongoDB: a table is a collection with a validator, and its keys are unique indexes", () => {
  const sql = generateMigrationSql(
    diffTargetAgainstLive(project(), schemaForDialect(project([USERS]), "mongodb")),
    "mongodb",
  );
  const [create, indexes] = commandsOf(sql);
  assert.equal(create!.create, "users");
  const schema = (create!.validator as { $jsonSchema: Record<string, unknown> }).$jsonSchema;
  assert.deepEqual(schema.required, ["id", "name"]);
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.id!.bsonType, "int");
  assert.equal(properties.name!.bsonType, "string");
  // nullable: the type or null
  assert.deepEqual(properties.email!.bsonType, ["string", "null"]);
  // a decimal keeps its precision in the description, and still has a BSON type
  assert.deepEqual(properties.balance!.bsonType, ["decimal", "null"]);
  assert.equal(properties.balance!.description, "decimal(18,6)");
  // the type as written is what is read back
  assert.equal(properties.name!.description, "varchar(255)");
  assert.equal(indexes!.createIndexes, "users");
  assert.deepEqual(indexes!.indexes, [
    { key: { id: 1 }, name: "pk_users", unique: true },
    { key: { email: 1 }, name: "uq_users_email", unique: true },
  ]);
});

test("MongoDB: a secondary index is created with the collection", () => {
  const canvas = project([
    {
      name: "orders",
      fields: [
        { name: "id", type: "bigint", pk: true },
        { name: "user_id", type: "int" },
      ],
      indexes: [["user_id"]],
    },
  ]);
  const [, indexes] = commandsOf(generateMigrationSql(diffTargetAgainstLive(project(), canvas), "mongodb"));
  const names = (indexes!.indexes as { name: string }[]).map((i) => i.name);
  assert.deepEqual(names, ["pk_orders", "idx_orders_user_id"]);
});

test("MongoDB: a dropped table is a drop command, kept when the answer says so", () => {
  const diff = diffTargetAgainstLive(project([USERS]), project());
  assert.deepEqual(commandsOf(generateMigrationSql(diff, "mongodb")), [{ drop: "users" }]);
  const kept = generateMigrationSql(diff, "mongodb", { "table:users": { strategy: "KEEP_IN_DB" } });
  assert.deepEqual(commandsOf(kept), []);
});

test("MongoDB: a changed collection has its validator stated again, and a dropped field is unset", () => {
  const live = project([
    {
      name: "t",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "gone", type: "text" },
      ],
    },
  ]);
  const canvas = project([
    {
      name: "t",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "fresh", type: "text" },
      ],
    },
  ]);
  const commands = commandsOf(generateMigrationSql(diffTargetAgainstLive(live, canvas), "mongodb"));
  assert.ok(commands.some((c) => "update" in c && JSON.stringify(c).includes('"$unset":{"gone":""}')));
  const mod = commands.find((c) => "collMod" in c)!;
  const properties = (mod.validator as { $jsonSchema: { properties: object } }).$jsonSchema.properties;
  assert.deepEqual(Object.keys(properties), ["id", "fresh"]);
});

test("MongoDB: the probe before dropping a collection is a count command, not SQL", () => {
  const probes = planRiskProbes(diffTargetAgainstLive(project([USERS]), project()), "mongodb");
  assert.equal(probes.length, 1);
  assert.deepEqual(JSON.parse(probes[0]!.sql), { count: "users" });
});

test("MongoDB: only whole collections are rolled back", () => {
  const added = generateRollbackSql(diffTargetAgainstLive(project(), project([USERS])), "mongodb");
  assert.deepEqual(commandsOf(added.sql), [{ drop: "users" }]);
  const dropped = generateRollbackSql(diffTargetAgainstLive(project([USERS]), project()), "mongodb");
  assert.equal(commandsOf(dropped.sql)[0]!.create, "users");
  assert.match(dropped.irreversible.join(" "), /recreated empty/);
  const modified = generateRollbackSql(
    diffTargetAgainstLive(project([USERS]), project([{ ...USERS, fields: USERS.fields.slice(0, 2) }])),
    "mongodb",
  );
  assert.match(modified.irreversible.join(" "), /not undone/);
});

test("Redis: the schema holds no table, so a deployment has nothing to do", () => {
  const held = schemaForDialect(project([USERS]), "redis");
  assert.deepEqual(held.tables, []);
  assert.match(generateMigrationSql(diffTargetAgainstLive(project(), held), "redis"), /No schema differences/);
  assert.match(generateCreateTable(project([USERS]).tables[0]!, "redis"), /Redis stores keys, not tables/);
  assert.match(
    generateRollbackSql(diffTargetAgainstLive(project(), project([USERS])), "redis").sql,
    /nothing to roll back/,
  );
  assert.deepEqual(planRiskProbes(diffTargetAgainstLive(project([USERS]), project()), "redis"), []);
});
