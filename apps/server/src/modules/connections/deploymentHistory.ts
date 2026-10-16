import crypto from "node:crypto";
import type { AcceptedRisk, DatabaseEngine, DeploymentHistoryEntry, SeedResult } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";

/** A stored JSON column (`accepted_risks`, `seed_report`); anything unreadable reads as none rather than failing the history. */
function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

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
  accepted_risks: string | null;
  seed_report: string | null;
  risk_note: string | null;
  backup_id: string | null;
  created_at: string;
  review_requested_by_email: string | null;
  review_requested_at: string | null;
  review_decided_by_email: string | null;
  review_decided_at: string | null;
  review_message: string | null;
  review_comment: string | null;
  review_id: string | null;
}

/** A history row with the review it went through, when there was one — who asked and who approved are part of what ran. */
const SELECT_HISTORY = `
  SELECT h.*, r.requested_by_email AS review_requested_by_email, r.requested_at AS review_requested_at,
         r.decided_by_email AS review_decided_by_email, r.decided_at AS review_decided_at,
         r.message AS review_message, r.decision_comment AS review_comment
    FROM deployment_history h LEFT JOIN deployment_reviews r ON r.id = h.review_id`;

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
    ...(row.accepted_risks ? { acceptedRisks: parseJsonArray<AcceptedRisk>(row.accepted_risks) } : {}),
    ...(row.risk_note ? { riskNote: row.risk_note } : {}),
    ...(row.seed_report ? { seedReport: parseJsonArray<SeedResult>(row.seed_report) } : {}),
    ...(row.backup_id ? { backupId: row.backup_id } : {}),
    ...(row.review_id && row.review_requested_by_email && row.review_requested_at
      ? {
          review: {
            id: row.review_id,
            requestedByEmail: row.review_requested_by_email,
            requestedAt: row.review_requested_at,
            approvedByEmail: row.review_decided_by_email,
            approvedAt: row.review_decided_at,
            ...(row.review_message ? { message: row.review_message } : {}),
            ...(row.review_comment ? { comment: row.review_comment } : {}),
          },
        }
      : {}),
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
  acceptedRisks?: AcceptedRisk[];
  riskNote?: string | null;
  seedReport?: SeedResult[];
  backupId?: string | null;
  /** The schema this deployment deployed (`pipeline.ts#schemaHashOf`); absent for a rollback. */
  schemaHash?: string | null;
  /** The approved review request this deployment carried out, on a stage that asks for one. */
  reviewId?: string | null;
}

export async function recordDeployment(input: RecordDeploymentInput): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO deployment_history
       (id, project_id, connection_id, connection_name, environment, engine, sql, rollback_sql, rollback_of,
        success, executed_statements, total_statements, error, executed_by_email, accepted_risks, risk_note, seed_report,
        backup_id, schema_hash, review_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
      input.acceptedRisks && input.acceptedRisks.length > 0 ? JSON.stringify(input.acceptedRisks) : null,
      input.riskNote?.trim() || null,
      input.seedReport && input.seedReport.length > 0 ? JSON.stringify(input.seedReport) : null,
      input.backupId ?? null,
      input.schemaHash ?? null,
      input.reviewId ?? null,
    );
  return id;
}

const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Newest first, for one connection *as used by one project* — a connection can
 * be attached to several, and each only sees its own deployments. `rolledBack`
 * is computed per row (a successful rollback entry pointing back at it), not
 * stored, so it can never drift out of sync with reality.
 */
export async function listDeploymentHistory(
  projectId: string,
  connectionId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<DeploymentHistoryEntry[]> {
  const rows = (await db
    .prepare(
      `${SELECT_HISTORY} WHERE h.connection_id = ? AND h.project_id = ?
        ORDER BY h.created_at DESC, h.seq DESC LIMIT ?`,
    )
    .all(connectionId, projectId, limit)) as HistoryRow[];
  const rolledBackIds = new Set(
    (
      (await db
        .prepare(
          `SELECT DISTINCT rollback_of FROM deployment_history
            WHERE connection_id = ? AND project_id = ? AND success = 1 AND rollback_of IS NOT NULL`,
        )
        .all(connectionId, projectId)) as { rollback_of: string }[]
    ).map((r) => r.rollback_of),
  );
  return rows.map((row) => rowToEntry(row, rolledBackIds.has(row.id)));
}

export async function getDeploymentHistoryEntry(id: string): Promise<DeploymentHistoryEntry | null> {
  const row = (await db.prepare(`${SELECT_HISTORY} WHERE h.id = ?`).get(id)) as HistoryRow | undefined;
  if (!row) return null;
  const alreadyRolledBack = await db
    .prepare("SELECT 1 FROM deployment_history WHERE rollback_of = ? AND success = 1 LIMIT 1")
    .get(id);
  return rowToEntry(row, Boolean(alreadyRolledBack));
}

/** A history row as the migration export reads it: who ran it by name, and the schema it deployed. */
export interface DeploymentExportRow extends DeploymentHistoryEntry {
  executedByName: string | null;
  schemaHash: string | null;
}

/**
 * Every deployment of one connection *as used by one project*, oldest first —
 * the order they ran in (`seq` breaks ties inside one second), so a replay
 * of the successful ones rebuilds the database. Not limited, unlike the list
 * the history panel shows.
 */
export async function listDeploymentsForExport(
  projectId: string,
  connectionId: string,
): Promise<DeploymentExportRow[]> {
  const rows = (await db
    .prepare(
      `SELECT d.*, u.display_name AS executed_by_name
         FROM deployment_history d LEFT JOIN users u ON u.email = d.executed_by_email
        WHERE d.connection_id = ? AND d.project_id = ?
        ORDER BY d.created_at ASC, d.seq ASC`,
    )
    .all(connectionId, projectId)) as (HistoryRow & { executed_by_name: string | null; schema_hash: string | null })[];
  const rolledBackIds = new Set(
    (
      (await db
        .prepare(
          `SELECT DISTINCT rollback_of FROM deployment_history
            WHERE connection_id = ? AND project_id = ? AND success = 1 AND rollback_of IS NOT NULL`,
        )
        .all(connectionId, projectId)) as { rollback_of: string }[]
    ).map((r) => r.rollback_of),
  );
  return rows.map((row) => ({
    ...rowToEntry(row, rolledBackIds.has(row.id)),
    executedByName: row.executed_by_name,
    schemaHash: row.schema_hash,
  }));
}
