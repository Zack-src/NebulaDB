import crypto from "node:crypto";
import type { DbQueryStat, DbQueryStatSort } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { normalizeSql } from "./sqlShape.js";

/**
 * How often each statement shape runs through Athanor's SQL console on a
 * connection, and how long it takes *as Athanor measures it* — around the
 * call, opening the connection included. Not the database server's own
 * statistics (`pg_stat_statements` and the like are another feature), and
 * never shown as such.
 *
 * Kept per UTC day, so a period can be summed and old days dropped
 * (`ATHANORDB_QUERY_STATS_RETENTION_DAYS`). The statement is stored with
 * every literal replaced by `?` — no value typed in a statement, and no row
 * it returned, is kept here.
 */

export const QUERY_STATS_MAX = 200;

export function queryHash(normalized: string): string {
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export interface QueryStatInput {
  connectionId: string;
  userId: string | null;
  sql: string;
  success: boolean;
  rowCount: number | null;
  durationMs: number | null;
}

/** Adds one execution to today's bucket of its statement shape. Never throws. */
export function recordQueryStat(input: QueryStatInput): void {
  try {
    const engine = (
      db.prepare("SELECT engine FROM db_connections WHERE id = ?").get(input.connectionId) as
        { engine: string } | undefined
    )?.engine;
    const normalized = normalizeSql(input.sql, engine);
    if (!normalized) return;
    const ms = Math.max(0, Math.round(input.durationMs ?? 0));
    const counted = input.success && input.rowCount !== null ? 1 : 0;
    db.prepare(
      `INSERT INTO query_stats (connection_id, query_hash, day, normalized_sql, executions, failures, total_ms, max_ms,
                                rows_total, rows_counted, last_at, last_user_id)
       VALUES (?, ?, date('now'), ?, 1, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(connection_id, query_hash, day) DO UPDATE SET
         executions = executions + 1,
         failures = failures + excluded.failures,
         total_ms = total_ms + excluded.total_ms,
         max_ms = MAX(max_ms, excluded.max_ms),
         rows_total = rows_total + excluded.rows_total,
         rows_counted = rows_counted + excluded.rows_counted,
         last_at = excluded.last_at,
         last_user_id = excluded.last_user_id`,
    ).run(
      input.connectionId,
      queryHash(normalized),
      normalized,
      input.success ? 0 : 1,
      ms,
      ms,
      counted ? input.rowCount : 0,
      counted,
      input.userId,
    );
  } catch (err) {
    // A statistic must never fail the query it counts.
    console.error("[dbAdmin] failed to record query statistics:", err);
  }
}

interface StatRow {
  hash: string;
  sql: string;
  executions: number;
  failures: number;
  total_ms: number;
  max_ms: number;
  rows_total: number;
  rows_counted: number;
  last_at: string;
  last_user_name: string | null;
}

const ORDER: Record<DbQueryStatSort, string> = {
  frequency: "executions DESC, total_ms DESC",
  slowest: "(CAST(total_ms AS REAL) / executions) DESC, executions DESC",
  total: "total_ms DESC, executions DESC",
};

/** The statement shapes run on a connection since `sinceDays` days (all kept days when absent), aggregated. */
export function listQueryStats(
  connectionId: string,
  options: { sinceDays?: number; sort?: DbQueryStatSort; limit?: number } = {},
): DbQueryStat[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), QUERY_STATS_MAX);
  const since = options.sinceDays ? `-${Math.trunc(options.sinceDays) - 1} days` : null;
  const rows = db
    .prepare(
      `SELECT s.hash, s.sql, s.executions, s.failures, s.total_ms, s.max_ms, s.rows_total, s.rows_counted, s.last_at,
              (SELECT u.display_name FROM query_stats q LEFT JOIN users u ON u.id = q.last_user_id
                WHERE q.connection_id = ? AND q.query_hash = s.hash ORDER BY q.last_at DESC LIMIT 1) AS last_user_name
         FROM (SELECT query_hash AS hash, MAX(normalized_sql) AS sql, SUM(executions) AS executions,
                      SUM(failures) AS failures, SUM(total_ms) AS total_ms, MAX(max_ms) AS max_ms,
                      SUM(rows_total) AS rows_total, SUM(rows_counted) AS rows_counted, MAX(last_at) AS last_at
                 FROM query_stats
                WHERE connection_id = ? ${since ? "AND day >= date('now', ?)" : ""}
                GROUP BY query_hash) s
        ORDER BY ${ORDER[options.sort ?? "frequency"]}
        LIMIT ?`,
    )
    .all(connectionId, connectionId, ...(since ? [since] : []), limit) as StatRow[];
  return rows.map((row) => ({
    hash: row.hash,
    sql: row.sql,
    executions: row.executions,
    failures: row.failures,
    avgMs: Math.round(row.total_ms / Math.max(row.executions, 1)),
    maxMs: row.max_ms,
    totalMs: row.total_ms,
    avgRows: row.rows_counted > 0 ? Math.round(row.rows_total / row.rows_counted) : null,
    lastAt: row.last_at,
    lastUserName: row.last_user_name,
  }));
}

/** Drops the days past the retention, and what is left of deleted connections. `0` keeps everything. */
export function purgeOldQueryStats(retentionDays: number): number {
  let removed = db
    .prepare("DELETE FROM query_stats WHERE connection_id NOT IN (SELECT id FROM db_connections)")
    .run().changes;
  if (retentionDays > 0) {
    removed += db.prepare("DELETE FROM query_stats WHERE day < date('now', ?)").run(`-${retentionDays} days`).changes;
  }
  return removed;
}
