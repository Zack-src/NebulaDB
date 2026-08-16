import test from "node:test";
import assert from "node:assert/strict";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { generateRollbackSql } from "./rollbackGenerator.js";
import type { Project } from "@athanordb/shared";

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

test("no changes -> a no-op rollback with nothing flagged irreversible", () => {
  const live = makeSimpleProject([{ name: "t1", fields: [{ name: "id", type: "int" }] }]);
  const { sql, irreversible } = generateRollbackSql(diffTargetAgainstLive(live, live), "postgres");
  assert.ok(sql.includes("nothing to roll back"));
  assert.deepEqual(irreversible, []);
});

test("a table the forward migration added is dropped back out — fully reversible", () => {
  const live = makeSimpleProject([]);
  const target = makeSimpleProject([{ name: "widgets", fields: [{ name: "id", type: "int", pk: true }] }]);
  const diff = diffTargetAgainstLive(live, target);

  const { sql, irreversible } = generateRollbackSql(diff, "postgres");
  assert.ok(sql.includes('DROP TABLE IF EXISTS "widgets" CASCADE;'));
  assert.deepEqual(irreversible, []);
});

test("a confirmed table drop is recreated structurally, but flagged as data loss", () => {
  const live = makeSimpleProject([
    {
      name: "widgets",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "name", type: "text" },
      ],
    },
  ]);
  const target = makeSimpleProject([]);
  const diff = diffTargetAgainstLive(live, target);
  const resolutions = { "table:widgets": { strategy: "DROP_DATA_CONFIRMED" as const } };

  const { sql, irreversible } = generateRollbackSql(diff, "postgres", resolutions);
  assert.ok(sql.includes('CREATE TABLE "widgets"'));
  assert.ok(sql.includes('"id" int PRIMARY KEY'));
  assert.equal(irreversible.length, 1);
  assert.match(irreversible[0], /widgets.*cannot be restored/);
});

test("a table drop that was resolved KEEP_IN_DB never actually ran — rollback is a no-op for it", () => {
  const live = makeSimpleProject([{ name: "widgets", fields: [{ name: "id", type: "int" }] }]);
  const target = makeSimpleProject([]);
  const diff = diffTargetAgainstLive(live, target);
  const resolutions = { "table:widgets": { strategy: "KEEP_IN_DB" as const } };

  const { sql, irreversible } = generateRollbackSql(diff, "postgres", resolutions);
  assert.ok(!sql.includes("CREATE TABLE"));
  assert.equal(irreversible.length, 0);
});

test("an added column is dropped back out; a confirmed-dropped column is recreated and flagged", () => {
  const live = makeSimpleProject([
    {
      name: "users",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "legacy", type: "text" },
      ],
    },
  ]);
  const target = makeSimpleProject([
    {
      name: "users",
      fields: [
        { name: "id", type: "int", pk: true },
        { name: "email", type: "text" },
      ],
    },
  ]);
  const diff = diffTargetAgainstLive(live, target);
  const resolutions = { "column:users.legacy": { strategy: "DROP_DATA_CONFIRMED" as const } };

  const { sql, irreversible } = generateRollbackSql(diff, "postgres", resolutions);
  assert.ok(
    sql.includes('ALTER TABLE "users" DROP COLUMN IF EXISTS "email";'),
    "the added column should be dropped by rollback",
  );
  assert.ok(
    sql.includes('ALTER TABLE "users" ADD COLUMN "legacy" text;'),
    "the dropped column should be recreated by rollback",
  );
  assert.equal(irreversible.length, 1);
  assert.match(irreversible[0], /users\.legacy.*cannot be restored/);
});

test("a column kept via KEEP_IN_DB resolution needs no rollback action", () => {
  const live = makeSimpleProject([
    {
      name: "users",
      fields: [
        { name: "id", type: "int" },
        { name: "legacy", type: "text" },
      ],
    },
  ]);
  const target = makeSimpleProject([{ name: "users", fields: [{ name: "id", type: "int" }] }]);
  const diff = diffTargetAgainstLive(live, target);
  const resolutions = { "column:users.legacy": { strategy: "KEEP_IN_DB" as const } };

  const { sql, irreversible } = generateRollbackSql(diff, "postgres", resolutions);
  assert.ok(!sql.includes("legacy"));
  assert.equal(irreversible.length, 0);
});

test("a type change is reverted back to the original type on postgres", () => {
  const live = makeSimpleProject([{ name: "users", fields: [{ name: "age", type: "int" }] }]);
  const target = makeSimpleProject([{ name: "users", fields: [{ name: "age", type: "text" }] }]);
  const diff = diffTargetAgainstLive(live, target);

  const { sql } = generateRollbackSql(diff, "postgres");
  assert.ok(sql.includes('ALTER TABLE "users" ALTER COLUMN "age" TYPE int USING "age"::int;'));
});

test("resolution-driven data mutations (backfill/clear/delete) are flagged, not silently reversed", () => {
  const live = makeSimpleProject([{ name: "users", fields: [{ name: "note", type: "text", notNull: false }] }]);
  const target = makeSimpleProject([{ name: "users", fields: [{ name: "note", type: "text", notNull: true }] }]);
  const diff = diffTargetAgainstLive(live, target);
  const resolutions = { "column:users.note": { strategy: "BACKFILL_DEFAULT" as const, value: "'n/a'" } };

  const { irreversible } = generateRollbackSql(diff, "postgres", resolutions);
  assert.equal(irreversible.length, 1);
  assert.match(irreversible[0], /backfilled/);
});

test("added/dropped indexes invert to DROP INDEX / CREATE INDEX", () => {
  const live: Project = {
    ...makeSimpleProject([]),
    tables: [
      {
        id: "users",
        name: "users",
        fields: [{ id: "users.email", name: "email", type: "text" }],
        indexes: [{ id: "idx1", fieldIds: ["users.email"], unique: true, name: "idx_users_email" }],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
    ],
  };
  const target: Project = {
    ...makeSimpleProject([]),
    tables: [
      {
        id: "users",
        name: "users",
        fields: [
          { id: "users.email", name: "email", type: "text" },
          { id: "users.name", name: "name", type: "text" },
        ],
        indexes: [{ id: "idx2", fieldIds: ["users.name"], name: "idx_users_name" }],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
    ],
  };
  const diff = diffTargetAgainstLive(live, target);

  const { sql } = generateRollbackSql(diff, "postgres");
  // The forward migration added idx_users_name -> rollback drops it.
  assert.ok(sql.includes('DROP INDEX IF EXISTS "idx_users_name";'));
  // The forward migration dropped idx_users_email -> rollback recreates it.
  assert.ok(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");'));
});
