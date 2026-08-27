#!/usr/bin/env node
/**
 * Resets the 8 Docker target databases used for cross-engine deploy testing
 * (see docker-compose set up for this) to a clean slate, then redeploys the
 * DeepDetect project's current schema to each one via Athanor's public API
 * and prints a pass/fail table.
 *
 * Prereqs:
 *   - The 8 `athanor-*` containers running (postgres/mysql/mariadb/tidb/
 *     singlestore/yugabyte/mssql/oracle) — see the docker-compose.yml this
 *     session's Claude Code conversation produced.
 *   - The Athanor server running with ATHANORDB_SECRET set (needed to read
 *     back the stored connection credentials) and reachable at BASE_URL.
 *   - A connection already created in Athanor for each of the 8 engines,
 *     pointed at these containers (create once via the Connections UI or
 *     POST /api/v1/projects/:id/connections; this script only resets +
 *     redeploys, it doesn't create connections).
 *
 * Usage:
 *   node scripts/multi-db-redeploy-test.mjs
 *   ATHANOR_API_KEY=adb_... ATHANOR_PROJECT_ID=... node scripts/multi-db-redeploy-test.mjs
 *
 * Config below (env var overrides in parens) — adjust ports/passwords if
 * your docker-compose differs from the one this was built against.
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const { Pool: PgPool } = require("pg");
const oracledb = require("oracledb");

// ---- Config -----------------------------------------------------------

const BASE_URL = process.env.ATHANOR_BASE_URL || "http://localhost:3001/api/v1";
const PROJECT_ID = process.env.ATHANOR_PROJECT_ID || "bab4eed2-ae08-4682-b6cc-ceeec4d1b5aa"; // DeepDetect
const API_KEY = process.env.ATHANOR_API_KEY || "adb_Yi2Y1RIuWCQoVplK6VaDbNgFu6ZJPm8HXhZBikwwVb0";

const DB_PASSWORD = "AthanorTest123!";
const MSSQL_CONTAINER = "athanor-mssql";

// ---- Reset each target to an empty `deepdetect` database --------------

async function resetMysqlLike(port, user, password) {
  const conn = await mysql.createConnection({ host: "localhost", port, user, password });
  await conn.query("DROP DATABASE IF EXISTS deepdetect");
  await conn.query("CREATE DATABASE deepdetect");
  await conn.end();
}

async function resetPg(port, user, password, adminDb) {
  const pool = new PgPool({ host: "localhost", port, user, password, database: adminDb });
  const client = await pool.connect();
  try {
    // Athanor's own connection pool can still hold an open session on `deepdetect`
    // from the last deploy — DROP DATABASE fails against an in-use database, so
    // terminate every other backend on it first.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'deepdetect' AND pid <> pg_backend_pid()`,
    );
    await client.query("DROP DATABASE IF EXISTS deepdetect");
    await client.query("CREATE DATABASE deepdetect");
  } finally {
    client.release();
    await pool.end();
  }
}

async function resetMssql() {
  // execFileSync (argv array, no shell) — execSync's `cmd.exe /c` on Windows doesn't
  // strip single quotes the way bash does, so a shell-quoted password string ends up
  // containing the quote characters literally and sqlcmd's login fails.
  execFileSync(
    "docker",
    [
      "exec",
      MSSQL_CONTAINER,
      "/opt/mssql-tools18/bin/sqlcmd",
      "-S",
      "localhost",
      "-U",
      "sa",
      "-P",
      DB_PASSWORD,
      "-C",
      "-Q",
      "IF DB_ID('deepdetect') IS NOT NULL BEGIN ALTER DATABASE deepdetect SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE deepdetect; END CREATE DATABASE deepdetect;",
    ],
    { stdio: "pipe" },
  );
}

async function resetOracle() {
  const conn = await oracledb.getConnection({
    user: "system",
    password: DB_PASSWORD,
    connectString: "localhost:51521/FREEPDB1",
  });
  try {
    const res = await conn.execute(`SELECT table_name FROM all_tables WHERE owner = 'DEEPDETECT'`);
    for (const row of res.rows) {
      await conn.execute(`DROP TABLE "DEEPDETECT"."${row[0]}" CASCADE CONSTRAINTS`);
    }
    return res.rows.length;
  } finally {
    await conn.close();
  }
}

async function resetAllTargets() {
  console.log("Resetting all 8 target databases...");
  await resetMysqlLike(53306, "root", DB_PASSWORD);
  console.log("  mysql reset");
  await resetMysqlLike(53307, "root", DB_PASSWORD);
  console.log("  mariadb reset");
  await resetMysqlLike(54000, "root", "");
  console.log("  tidb reset");
  await resetMysqlLike(53308, "root", DB_PASSWORD);
  console.log("  singlestore reset");
  await resetPg(55432, "postgres", DB_PASSWORD, "postgres");
  console.log("  postgres reset");
  await resetPg(55433, "yugabyte", "", "yugabyte");
  console.log("  yugabyte reset");
  await resetMssql();
  console.log("  mssql reset");
  const dropped = await resetOracle();
  console.log(`  oracle reset (dropped ${dropped} tables)`);
}

// ---- Athanor API calls --------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function redeployAll() {
  const list = await api("GET", `/projects/${PROJECT_ID}/connections`);
  if (!list.json?.connections) {
    console.error("Could not list connections:", list.status, JSON.stringify(list.json));
    console.error("Is the Athanor server running with ATHANORDB_SECRET set?");
    process.exit(1);
  }

  const results = [];
  for (const c of list.json.connections) {
    let deploy = await api("POST", `/projects/${PROJECT_ID}/connections/${c.id}/deploy`, {});
    // Deploy is rate-limited; back off once and retry rather than failing the whole run.
    if (deploy.json?.code === "RATE_LIMITED" || deploy.status === 429) {
      await sleep(9000);
      deploy = await api("POST", `/projects/${PROJECT_ID}/connections/${c.id}/deploy`, {});
    }
    const r = deploy.json;
    const err = r.details?.error || r.error;
    results.push({
      name: c.name,
      engine: c.engine,
      success: Boolean(r.success),
      executed: r.executedStatements ?? "-",
      error: err ? String(err).slice(0, 200) : "",
    });
    await sleep(1500); // stays under the deploy rate limit across 8 calls
  }
  return results;
}

// ---- Main ---------------------------------------------------------------

async function main() {
  await resetAllTargets();
  console.log("\nRedeploying to all connections...\n");
  const results = await redeployAll();

  const nameWidth = Math.max(...results.map((r) => r.name.length), 20);
  for (const r of results) {
    const status = r.success ? "OK  " : "FAIL";
    console.log(`${r.name.padEnd(nameWidth)} (${r.engine.padEnd(8)}) ${status} executed=${r.executed}  ${r.error}`);
  }

  const failed = results.filter((r) => !r.success);
  console.log(`\n${results.length - failed.length}/${results.length} succeeded.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
