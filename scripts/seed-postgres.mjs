#!/usr/bin/env node
/**
 * Seeds the Postgres docker target (see `docker-compose.yml` / the
 * multi-engine deploy test session) with a large, FK-consistent dataset
 * centered on `item_prioritized` — its direct "elements" (item_computed,
 * prioritization, study, pod, analyse, comparability_type, groundfloor) and
 * its child `item_prioritized_nba` (with criteria/perimeter) — so
 * `bench-item-prioritized-select.mjs` has something realistic to query.
 *
 * Scope is deliberately shallow: those elements' *own* further FKs
 * (prioritization.id_creator, criteria.id_type, perimeter.id_indicator, ...)
 * are left NULL. They're nullable in the schema, and outside what the join
 * this is built for actually touches — seeding the whole ~100-table graph
 * transitively wasn't the ask.
 *
 * Usage:
 *   node scripts/seed-postgres.mjs
 *   ITEM_PRIORITIZED_COUNT=500000 node scripts/seed-postgres.mjs
 *
 * Config (env var overrides in parens) — same postgres-docker target the
 * multi-db-redeploy-test.mjs script resets (port 55432, db `deepdetect`).
 * Assumes the schema is already deployed there (via Athanor).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const PG_CONFIG = {
  host: "localhost",
  port: Number(process.env.PG_PORT || 55432),
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "AthanorTest123!",
  database: process.env.PG_DATABASE || "deepdetect",
};

// Lookup/parent table row counts — moderate, so `item_prioritized`'s FKs fan
// in realistically (many rows sharing the same parent) rather than 1:1.
const LOOKUP_COUNT = Number(process.env.LOOKUP_COUNT || 300);
// The big one — what the join in bench-item-prioritized-select.mjs scans.
const ITEM_PRIORITIZED_COUNT = Number(process.env.ITEM_PRIORITIZED_COUNT || 200_000);
// item_prioritized_nba's PK *is* id_item_prioritized (strict 1:1 to at most
// one row) — this fraction of item_prioritized rows get one, the rest don't,
// which is also what makes the LEFT JOIN onto it meaningful to test.
const NBA_FRACTION = Number(process.env.NBA_FRACTION || 0.75);

const BATCH_SIZE = 5000;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randOrNull(arr, nullChance = 0.1) {
  if (Math.random() < nullChance) return null;
  return arr[randInt(0, arr.length - 1)];
}
function randDecimal() {
  return (Math.random() * 100).toFixed(2);
}
function randDate() {
  const start = new Date(2020, 0, 1).getTime();
  const end = new Date(2026, 0, 1).getTime();
  return new Date(randInt(start, end)).toISOString();
}
function randName(prefix, i) {
  return `${prefix}_${i}`;
}

/**
 * Inserts `rows` (array of value-arrays, `id` NOT included) into
 * `table(columns)` in batches, assigning sequential ids ourselves and
 * returning them in order.
 *
 * `RETURNING id` off a real `SERIAL`/`IDENTITY` column would be the natural
 * way to do this, but Athanor's migration generator currently drops
 * `[increment]` entirely when emitting `CREATE TABLE` (a real bug, tracked
 * separately) — every deployed table's PK is a plain `int` with no identity
 * behind it. Assigning ids explicitly here is the workaround, not a stylistic
 * choice: it's what makes seeding possible against today's deployed schema
 * at all, since there's no default to omit `id` and let Postgres fill it in.
 */
async function batchInsert(pool, table, columns, rows, startId) {
  const idColumns = ["id", ...columns];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = chunk.map((row, r) => {
      const base = r * idColumns.length;
      values.push(startId + i + r, ...row);
      return `(${idColumns.map((_, c) => `$${base + c + 1}`).join(", ")})`;
    });
    const sql = `INSERT INTO "${table}" (${idColumns.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders.join(", ")}`;
    await pool.query(sql, values);
    process.stdout.write(`\r  ${table}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  console.log();
  return Array.from({ length: rows.length }, (_, i) => startId + i);
}

async function seedLookup(pool, table, count, columnBuilder) {
  console.log(`Seeding ${table} (${count} rows)...`);
  const rows = Array.from({ length: count }, (_, i) => columnBuilder(i));
  const columns = Object.keys(rows[0]);
  const rowValues = rows.map((r) => columns.map((c) => r[c]));
  return batchInsert(pool, table, columns, rowValues, 1);
}

async function main() {
  const pool = new Pool(PG_CONFIG);

  console.log(`Connecting to postgres://${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}...`);
  await pool.query("SELECT 1");

  console.log("\nTruncating existing seeded tables (CASCADE)...");
  // `analyse` (British spelling) is a reserved word in Postgres — an alias for
  // the ANALYZE keyword — so every identifier here is quoted defensively.
  await pool.query(`
    TRUNCATE TABLE
      "item_prioritized_nba", "item_prioritized",
      "item_computed", "prioritization", "study", "pod", "analyse", "comparability_type", "groundfloor",
      "criteria", "perimeter"
    RESTART IDENTITY CASCADE;
  `);

  // --- Lookup/parent tables --------------------------------------------
  const comparabilityTypeIds = await seedLookup(pool, "comparability_type", LOOKUP_COUNT, (i) => ({
    name: randName("comparability_type", i),
  }));
  const podIds = await seedLookup(pool, "pod", LOOKUP_COUNT, (i) => ({ name: randName("pod", i) }));
  const groundfloorIds = await seedLookup(pool, "groundfloor", LOOKUP_COUNT, (i) => ({
    name: randName("groundfloor", i),
    description: `description ${i}`,
  }));
  const studyIds = await seedLookup(pool, "study", LOOKUP_COUNT, (i) => ({ name: randName("study", i) }));
  const criteriaIds = await seedLookup(pool, "criteria", LOOKUP_COUNT, () => ({
    is_usable_prioritization: Math.random() < 0.5,
    id_type: null,
    id_nature: null,
  }));
  const perimeterIds = await seedLookup(pool, "perimeter", LOOKUP_COUNT, () => ({
    id_indicator: null,
    id_scenario_comparison: null,
    id_groundfloor: null,
  }));
  const itemComputedIds = await seedLookup(pool, "item_computed", LOOKUP_COUNT, () => ({
    year: randInt(2018, 2026),
    id_period: null,
    id_item: null,
  }));
  const analyseIds = await seedLookup(pool, "analyse", LOOKUP_COUNT, (i) => ({
    name: randName("analyse", i),
    description: `description ${i}`,
    date_creation: randDate(),
    date_last_run: randDate(),
    launch: randDate(),
    id_creator: null,
    id_launch_periodicity: null,
  }));
  const prioritizationIds = await seedLookup(pool, "prioritization", LOOKUP_COUNT, (i) => ({
    name: randName("prioritization", i),
    description: `description ${i}`,
    date_creation: randDate(),
    date_last_run: randDate(),
    id_status: null,
    id_creator: null,
    id_algorithm: null,
  }));

  // --- item_prioritized (the big table) ---------------------------------
  console.log(`\nSeeding item_prioritized (${ITEM_PRIORITIZED_COUNT} rows)...`);
  const ipColumns = [
    "rank",
    "id_item_computed",
    "id_prioritization",
    "id_study",
    "id_pod",
    "id_analyse",
    "id_comparability_type",
    "id_groundfloor",
  ];
  const ipRows = Array.from({ length: ITEM_PRIORITIZED_COUNT }, (_, i) => [
    i, // rank
    randOrNull(itemComputedIds),
    randOrNull(prioritizationIds),
    randOrNull(studyIds),
    randOrNull(podIds),
    randOrNull(analyseIds),
    randOrNull(comparabilityTypeIds),
    randOrNull(groundfloorIds),
  ]);
  const itemPrioritizedIds = await batchInsert(pool, "item_prioritized", ipColumns, ipRows, 1);

  // --- item_prioritized_nba (strict 1:1 — pk is id_item_prioritized) ----
  const nbaCount = Math.floor(itemPrioritizedIds.length * NBA_FRACTION);
  console.log(`\nSeeding item_prioritized_nba (${nbaCount} rows, ${Math.round(NBA_FRACTION * 100)}% of item_prioritized)...`);
  const shuffled = [...itemPrioritizedIds].sort(() => Math.random() - 0.5).slice(0, nbaCount);
  const nbaColumns = ["id_item_prioritized", "criteria_number", "percent_contribution", "id_criteria_return", "id_perimeter_return"];
  for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
    const chunk = shuffled.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = chunk.map((ipId, r) => {
      const base = r * nbaColumns.length;
      values.push(ipId, randInt(1, 20), randDecimal(), randOrNull(criteriaIds), randOrNull(perimeterIds));
      return `(${nbaColumns.map((_, c) => `$${base + c + 1}`).join(", ")})`;
    });
    await pool.query(
      `INSERT INTO "item_prioritized_nba" (${nbaColumns.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
    process.stdout.write(`\r  item_prioritized_nba: ${Math.min(i + BATCH_SIZE, shuffled.length)}/${shuffled.length}`);
  }
  console.log();

  console.log("\nDone. Row counts:");
  for (const t of [
    "comparability_type",
    "pod",
    "groundfloor",
    "study",
    "criteria",
    "perimeter",
    "item_computed",
    "analyse",
    "prioritization",
    "item_prioritized",
    "item_prioritized_nba",
  ]) {
    const res = await pool.query(`SELECT COUNT(*) FROM "${t}"`);
    console.log(`  ${t}: ${res.rows[0].count}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
