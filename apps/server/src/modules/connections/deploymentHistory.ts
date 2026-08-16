import crypto from "node:crypto";
import type { DatabaseEngine, DeploymentHistoryEntry } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";

interface HistoryRow {
  id: string;
  project_id: string;
  connection_id: string | null;
  connection_name: string;
  environment: string | null;
  engine: string;
  sql: string;
  rollback_sql: string | null;
  rollback_of: string | null;
  success: number;
  executed_statements: number;
  total_statements: number;
  error: string | null;
  executed_by_email: string | null;
  created_at: string;
}

function rowToEntry(row: HistoryRow, rolledBack: boolean): DeploymentHistoryEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    environment: row.environment ?? undefined,
    engine: row.engine as DatabaseEngine,
    sql: row.sql,
    rollbackSql: row.rollback_sql,
    rollbackOf: row.rollback_of,
    success: row.success === 1,
    executedStatements: row.executed_statements,
    totalStatements: row.total_statements,
    error: row.error ?? undefined,
    executedByEmail: row.executed_by_email,
    createdAt: row.created_at,
    rolledBack,
  };
}

export interface RecordDeploymentInput {
  projectId: string;
  connectionId: string | null;
  connectionName: string;
  environment: string | null;
  engine: DatabaseEngine;
  sql: string;
  /** Null when this entry is itself a rollback, or when there was nothing to roll back (e.g. no changes). */
  rollbackSql: string | null;
  /** Set when this entry *is* a rollback of another entry. */
  rollbackOf?: string;
  success: boolean;
  executedStatements: number;
  totalStatements: number;
  error?: string;
  executedByEmail: string | null;
}

export function recordDeployment(input: RecordDeploymentInput): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO deployment_history
       (id, project_id, connection_id, connection_name, environment, engine, sql, rollback_sql, rollback_of,
        success, executed_statements, total_statements, error, executed_by_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.connectionId,
    input.connectionName,
    input.environment,
    input.engine,
    input.sql,
    input.rollbackSql,
    input.rollbackOf ?? null,
    input.success ? 1 : 0,
    input.executedStatements,
    input.totalStatements,
    input.error ?? null,
    input.executedByEmail,
  );
  return id;
}

const DEFAULT_HISTORY_LIMIT = 50;

/** Newest first. `rolledBack` is computed per row (a successful rollback entry pointing back at it), not stored, so it can never drift out of sync with reality. */
export function listDeploymentHistory(connectionId: string, limit = DEFAULT_HISTORY_LIMIT): DeploymentHistoryEntry[] {
  const rows = db
    .prepare(`SELECT * FROM deployment_history WHERE connection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(connectionId, limit) as HistoryRow[];
  const rolledBackIds = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT rollback_of FROM deployment_history WHERE connection_id = ? AND success = 1 AND rollback_of IS NOT NULL`,
        )
        .all(connectionId) as { rollback_of: string }[]
    ).map((r) => r.rollback_of),
  );
  return rows.map((row) => rowToEntry(row, rolledBackIds.has(row.id)));
}

export function getDeploymentHistoryEntry(id: string): DeploymentHistoryEntry | null {
  const row = db.prepare("SELECT * FROM deployment_history WHERE id = ?").get(id) as HistoryRow | undefined;
  if (!row) return null;
  const alreadyRolledBack = db
    .prepare("SELECT 1 FROM deployment_history WHERE rollback_of = ? AND success = 1 LIMIT 1")
    .get(id);
  return rowToEntry(row, Boolean(alreadyRolledBack));
}
