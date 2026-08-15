import test from "node:test";
import assert from "node:assert/strict";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { generateMigrationSql } from "./migrationGenerator.js";
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
  assert.ok(sql.includes("CREATE TABLE \"posts\""));
  assert.ok(sql.includes("ALTER TABLE \"users\" ADD COLUMN \"created_at\" timestamptz NOT NULL DEFAULT NOW();"));
  assert.ok(sql.includes("ALTER TABLE \"users\" ALTER COLUMN \"count\" TYPE text USING \"count\"::text;"));
  assert.ok(sql.includes("-- Kept column \"users\".\"old_column\""));
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
  assert.ok(sqlDrop.includes("DROP TABLE IF EXISTS \"t1\" CASCADE;"));

  // Kept drop
  const sqlKeep = generateMigrationSql(diff, "postgres", {
    "table:t1": { strategy: "KEEP_IN_DB" },
  });
  assert.ok(sqlKeep.includes("-- Kept table \"t1\""));
});
