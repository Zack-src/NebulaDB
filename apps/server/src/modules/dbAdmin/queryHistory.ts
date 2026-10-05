import crypto from "node:crypto";
import type { DbAdminQueryHistoryEntry } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { recordQueryStat } from "./queryStats.js";

/** Per admin and per connection. A recall aid, not a record: the audit log is the accountable trail. */
const MAX_ENTRIES = 200;
const MAX_SQL_LENGTH = 20_000;

interface Row {
  id: string;
  database_name: string | null;
  sql: string;
  read_only: number;
  success: number;
  row_count: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface QueryHistoryInput {
  connectionId: string;
  userId: string;
  database: string | null;
  sql: string;
  readOnly: boolean;
  success: boolean;
  rowCount: number | null;
  durationMs: number | null;
  error: string | null;
}

export function recordQuery(input: QueryHistoryInput): void {
  // The per-statement figures of the connection's journal ("Requêtes"), literals masked.
  recordQueryStat(input);
  try {
    db.prepare(
      `INSERT INTO admin_query_history
         (id, connection_id, user_id, database_name, sql, read_only, success, row_count, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      input.connectionId,
      input.userId,
      input.database,
      input.sql.slice(0, MAX_SQL_LENGTH),
      input.readOnly ? 1 : 0,
      input.success ? 1 : 0,
      input.rowCount,
      input.durationMs,
      input.error?.slice(0, 1000) ?? null,
    );
    db.prepare(
      `DELETE FROM admin_query_history
        WHERE connection_id = ? AND user_id = ? AND id NOT IN (
          SELECT id FROM admin_query_history WHERE connection_id = ? AND user_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
    ).run(input.connectionId, input.userId, input.connectionId, input.userId, MAX_ENTRIES);
  } catch (err) {
    // Losing a history row must never fail the query it describes.
    console.error("[dbAdmin] failed to record query history:", err);
  }
}

export function listQueryHistory(connectionId: string, userId: string, limit = 50): DbAdminQueryHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM admin_query_history WHERE connection_id = ? AND user_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(connectionId, userId, Math.min(Math.max(limit, 1), MAX_ENTRIES)) as Row[];
  return rows.map((r) => ({
    id: r.id,
    database: r.database_name,
    sql: r.sql,
    readOnly: r.read_only === 1,
    success: r.success === 1,
    rowCount: r.row_count,
    durationMs: r.duration_ms,
    error: r.error,
    createdAt: r.created_at,
  }));
}
