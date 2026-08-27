#!/usr/bin/env node
/**
 * Benchmarks SELECTs against `item_prioritized` joined with everything it
 * (and its `item_prioritized_nba` child) directly links to — the query
 * `seed-postgres.mjs` populates data for. Runs each query a few times
 * (Postgres caches the plan/pages after the first run, so a single
 * measurement is mostly noise) and reports min/avg/max wall-clock time
 * alongside `EXPLAIN ANALYZE`'s own reported planning/execution time.
 *
 * Usage:
 *   node scripts/bench-item-prioritized-select.mjs
 *   node scripts/bench-item-prioritized-select.mjs --with-indexes   # see the FK-index section below
 *
 * Config: same postgres-docker target as seed-postgres.mjs (port 55432, db
 * `deepdetect`), override via PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE.
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

const RUNS = 5;

// The full join: item_prioritized + every table it (or its item_prioritized_nba
// child) directly references. LEFT JOIN throughout — every FK column involved
// is nullable in the schema (see the table dumps in the session that built
// this), and item_prioritized_nba only exists for a fraction of rows.
const FULL_JOIN_SQL = `
  SELECT
    ip.id, ip.rank,
    ic.year AS computed_year,
    pr.name AS prioritization_name, pr.date_creation AS prioritization_date_creation,
    st.name AS study_name,
    pd.name AS pod_name,
    an.name AS analyse_name,
    ct.name AS comparability_type_name,
    gf.name AS groundfloor_name,
    nba.criteria_number, nba.percent_contribution,
    cr.is_usable_prioritization,
    pe.id_indicator
  FROM item_prioritized ip
  LEFT JOIN item_computed        ic  ON ic.id = ip.id_item_computed
  LEFT JOIN prioritization       pr  ON pr.id = ip.id_prioritization
  LEFT JOIN study                st  ON st.id = ip.id_study
  LEFT JOIN pod                  pd  ON pd.id = ip.id_pod
  LEFT JOIN "analyse"             an  ON an.id = ip.id_analyse
  LEFT JOIN comparability_type   ct  ON ct.id = ip.id_comparability_type
  LEFT JOIN groundfloor          gf  ON gf.id = ip.id_groundfloor
  LEFT JOIN item_prioritized_nba nba ON nba.id_item_prioritized = ip.id
  LEFT JOIN criteria             cr  ON cr.id = nba.id_criteria_return
  LEFT JOIN perimeter            pe  ON pe.id = nba.id_perimeter_return
`;

const QUERIES = {
  "COUNT(*) over the full join (forces a full scan, no data transfer)": `SELECT COUNT(*) FROM (${FULL_JOIN_SQL}) q`,
  "Full join, first 100 rows ordered by id": `${FULL_JOIN_SQL} ORDER BY ip.id LIMIT 100`,
  "Full join, single row by id (point lookup)": `${FULL_JOIN_SQL} WHERE ip.id = $1`,
  "Full join filtered by rank range (100-row window mid-table)": `${FULL_JOIN_SQL} WHERE ip.rank BETWEEN 50000 AND 50100`,
};

// FK columns this query actually joins on. None of these are indexed by a
// plain Athanor deploy today — a `Ref:` only becomes a FOREIGN KEY constraint,
// which Postgres does NOT auto-index (unlike the PK/unique side of it). Every
// join above does a seq scan + hash/merge join without these.
const FK_INDEX_COLUMNS = [
  ["item_prioritized", "id_item_computed"],
  ["item_prioritized", "id_prioritization"],
  ["item_prioritized", "id_study"],
  ["item_prioritized", "id_pod"],
  ["item_prioritized", "id_analyse"],
  ["item_prioritized", "id_comparability_type"],
  ["item_prioritized", "id_groundfloor"],
  ["item_prioritized", "rank"],
  ["item_prioritized_nba", "id_criteria_return"],
  ["item_prioritized_nba", "id_perimeter_return"],
];

function fmtMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

async function timeQuery(pool, sql, params) {
  const start = process.hrtime.bigint();
  const res = await pool.query(sql, params);
  const end = process.hrtime.bigint();
  return { ms: Number(end - start) / 1e6, rowCount: res.rowCount };
}

async function explainAnalyze(pool, sql, params) {
  const res = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
  const plan = res.rows[0]["QUERY PLAN"][0];
  return { planningMs: plan["Planning Time"], executionMs: plan["Execution Time"] };
}

async function benchQuery(pool, label, sql, paramsFn) {
  console.log(`\n=== ${label} ===`);
  const timings = [];
  let rowCount = 0;
  for (let i = 0; i < RUNS; i++) {
    const params = paramsFn ? await paramsFn(pool) : undefined;
    const { ms, rowCount: rc } = await timeQuery(pool, sql, params);
    timings.push(ms);
    rowCount = rc;
  }
  const min = Math.min(...timings);
  const max = Math.max(...timings);
  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
  console.log(`  wall-clock over ${RUNS} runs: min=${fmtMs(min)} avg=${fmtMs(avg)} max=${fmtMs(max)}  (rows=${rowCount})`);

  const params = paramsFn ? await paramsFn(pool) : undefined;
  const { planningMs, executionMs } = await explainAnalyze(pool, sql, params);
  console.log(`  EXPLAIN ANALYZE: planning=${fmtMs(planningMs)} execution=${fmtMs(executionMs)}`);
}

async function pickRandomId(pool) {
  const res = await pool.query(`SELECT id FROM item_prioritized ORDER BY random() LIMIT 1`);
  return [res.rows[0].id];
}

async function main() {
  const withIndexes = process.argv.includes("--with-indexes");
  const pool = new Pool(PG_CONFIG);

  console.log(`Connecting to postgres://${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}...`);
  const countRes = await pool.query(`SELECT COUNT(*) FROM item_prioritized`);
  console.log(`item_prioritized has ${countRes.rows[0].count} rows.`);
  if (Number(countRes.rows[0].count) === 0) {
    console.error("No data — run `node scripts/seed-postgres.mjs` first.");
    process.exit(1);
  }

  if (withIndexes) {
    console.log("\n--with-indexes: creating indexes on every FK column this join touches...");
    for (const [table, column] of FK_INDEX_COLUMNS) {
      const indexName = `idx_${table}_${column}`;
      await pool.query(`CREATE INDEX IF NOT EXISTS "${indexName}" ON "${table}" ("${column}")`);
      console.log(`  ${indexName} on ${table}(${column})`);
    }
    await pool.query(`ANALYZE`);
  } else {
    console.log(
      "\nNo indexes on the FK columns this join uses (that's what a plain Athanor deploy produces today — " +
        "a Ref: becomes a FOREIGN KEY constraint, which Postgres doesn't auto-index). Pass --with-indexes to compare.",
    );
  }

  for (const [label, sql] of Object.entries(QUERIES)) {
    await benchQuery(pool, label, sql, label.includes("point lookup") ? pickRandomId : undefined);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
