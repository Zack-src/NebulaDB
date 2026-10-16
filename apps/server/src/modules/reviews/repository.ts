import crypto from "node:crypto";
import type {
  AcceptedRisk,
  DatabaseEngine,
  DeploymentReviewCloseReason,
  DeploymentReviewStatus,
  MigrationResolutionMap,
} from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";

/**
 * Storage of the review requests (`deployment_reviews`). Nothing here decides
 * who may do what — see `service.ts`; this only reads and writes rows.
 */

/** `YYYY-MM-DD HH:MM:SS`, UTC — the format of every other date the app stores, written here rather than by the database. */
export function sqlTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

interface ReviewRow {
  id: string;
  project_id: string;
  connection_id: string | null;
  connection_name: string;
  environment_id: string | null;
  environment: string | null;
  engine: string;
  status: string;
  schema_hash: string;
  sql: string;
  resolutions_json: string;
  risks_json: string;
  seeds_hash: string | null;
  skip_seeds: number;
  risk_note: string | null;
  message: string | null;
  requested_by: string | null;
  requested_by_email: string;
  requested_at: string;
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  expires_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  deployment_id: string | null;
}

/** A request as stored: everything it froze, and who did what to it. */
export interface StoredReview {
  id: string;
  projectId: string;
  connectionId: string | null;
  connectionName: string;
  environmentId: string | null;
  environment: string | null;
  engine: DatabaseEngine;
  status: DeploymentReviewStatus;
  schemaHash: string;
  sql: string;
  resolutions: MigrationResolutionMap;
  risks: AcceptedRisk[];
  seedsHash: string | null;
  skipSeeds: boolean;
  riskNote: string | null;
  message: string | null;
  requestedBy: string | null;
  requestedByEmail: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  comment: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  closeReason: DeploymentReviewCloseReason | null;
  deploymentId: string | null;
}

function rowToReview(row: ReviewRow): StoredReview {
  return {
    id: row.id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    environmentId: row.environment_id,
    environment: row.environment,
    engine: row.engine as DatabaseEngine,
    status: row.status as DeploymentReviewStatus,
    schemaHash: row.schema_hash,
    sql: row.sql,
    resolutions: JSON.parse(row.resolutions_json) as MigrationResolutionMap,
    risks: JSON.parse(row.risks_json) as AcceptedRisk[],
    seedsHash: row.seeds_hash,
    skipSeeds: row.skip_seeds === 1,
    riskNote: row.risk_note,
    message: row.message,
    requestedBy: row.requested_by,
    requestedByEmail: row.requested_by_email,
    requestedAt: row.requested_at,
    decidedBy: row.decided_by,
    decidedByEmail: row.decided_by_email,
    decidedAt: row.decided_at,
    comment: row.decision_comment,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason as DeploymentReviewCloseReason | null,
    deploymentId: row.deployment_id,
  };
}

export interface NewReview {
  projectId: string;
  connectionId: string;
  connectionName: string;
  environmentId: string | null;
  environment: string | null;
  engine: DatabaseEngine;
  schemaHash: string;
  sql: string;
  resolutions: MigrationResolutionMap;
  risks: AcceptedRisk[];
  seedsHash: string | null;
  skipSeeds: boolean;
  riskNote: string | null;
  message: string | null;
  requestedBy: string;
  requestedByEmail: string;
  requestedAt: Date;
}

/**
 * Stores a new `pending` request, unless the project already has an open one
 * for that connection: returns `null` then. The check and the insert are one
 * transaction, and the table's unique index on open requests is the last word.
 */
export async function insertReview(input: NewReview): Promise<StoredReview | null> {
  const id = crypto.randomUUID();
  const inserted = await db.transaction(async () => {
    if (await findOpenReview(input.projectId, input.connectionId)) return false;
    await db
      .prepare(
        `INSERT INTO deployment_reviews
         (id, project_id, connection_id, connection_name, environment_id, environment, engine, status, schema_hash,
          sql, resolutions_json, risks_json, seeds_hash, skip_seeds, risk_note, message, requested_by,
          requested_by_email, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.connectionId,
        input.connectionName,
        input.environmentId,
        input.environment,
        input.engine,
        input.schemaHash,
        input.sql,
        JSON.stringify(input.resolutions),
        JSON.stringify(input.risks),
        input.seedsHash,
        input.skipSeeds ? 1 : 0,
        input.riskNote,
        input.message,
        input.requestedBy,
        input.requestedByEmail,
        sqlTime(input.requestedAt),
      );
    return true;
  });
  return inserted ? await getReview(id) : null;
}

export async function getReview(id: string): Promise<StoredReview | null> {
  const row = (await db.prepare("SELECT * FROM deployment_reviews WHERE id = ?").get(id)) as ReviewRow | undefined;
  return row ? rowToReview(row) : null;
}

/** The project's request still waiting for a decision or a deployment on this connection, if any. */
export async function findOpenReview(projectId: string, connectionId: string): Promise<StoredReview | null> {
  const row = (await db
    .prepare(
      `SELECT * FROM deployment_reviews
        WHERE project_id = ? AND connection_id = ? AND status IN ('pending', 'approved')`,
    )
    .get(projectId, connectionId)) as ReviewRow | undefined;
  return row ? rowToReview(row) : null;
}

/** The project's requests, newest first — open and closed. */
export async function listProjectReviews(projectId: string, limit: number): Promise<StoredReview[]> {
  return (
    (await db
      .prepare("SELECT * FROM deployment_reviews WHERE project_id = ? ORDER BY requested_at DESC, id LIMIT ?")
      .all(projectId, limit)) as ReviewRow[]
  ).map(rowToReview);
}

/** An open request with where its connection stands now — what `reconcileReviews` judges it on. */
export interface OpenReviewState {
  review: StoredReview;
  /** The connection is still attached to the project. */
  linked: boolean;
  /** The stage the connection is on now, and its protection. */
  currentEnvironmentId: string | null;
  currentProtection: string | null;
}

/** Every open request (of one project, or of the instance) with its connection's present stage. */
export async function listOpenReviewStates(projectId?: string): Promise<OpenReviewState[]> {
  const open = `
    SELECT r.*, l.connection_id AS linked_connection_id, c.environment_id AS current_environment_id,
           e.protection AS current_protection
      FROM deployment_reviews r
      LEFT JOIN project_connection_links l ON l.project_id = r.project_id AND l.connection_id = r.connection_id
      LEFT JOIN db_connections c ON c.id = r.connection_id
      LEFT JOIN environments e ON e.id = c.environment_id
     WHERE r.status IN ('pending', 'approved')`;
  const rows = (
    projectId ? await db.prepare(`${open} AND r.project_id = ?`).all(projectId) : await db.prepare(open).all()
  ) as (ReviewRow & {
    linked_connection_id: string | null;
    current_environment_id: string | null;
    current_protection: string | null;
  })[];
  return rows.map((row) => ({
    review: rowToReview(row),
    linked: row.linked_connection_id !== null,
    currentEnvironmentId: row.current_environment_id,
    currentProtection: row.current_protection,
  }));
}

/**
 * Records a decision on a `pending` request. `expiresAt` is set for an
 * approval. Returns whether a row changed: `false` means someone else decided
 * or withdrew it in between.
 */
export async function decideReview(
  id: string,
  decision: { status: "approved" | "rejected"; by: string; byEmail: string; comment: string | null; at: Date },
  expiresAt: Date | null,
): Promise<boolean> {
  const at = sqlTime(decision.at);
  return (
    (
      await db
        .prepare(
          `UPDATE deployment_reviews
            SET status = ?, decided_by = ?, decided_by_email = ?, decided_at = ?, decision_comment = ?, expires_at = ?,
                closed_at = ?
          WHERE id = ? AND status = 'pending'`,
        )
        .run(
          decision.status,
          decision.by,
          decision.byEmail,
          at,
          decision.comment,
          expiresAt ? sqlTime(expiresAt) : null,
          decision.status === "rejected" ? at : null,
          id,
        )
    ).changes > 0
  );
}

/** Closes an open request for good. Returns whether a row changed. */
export async function closeReview(
  id: string,
  status: "withdrawn" | "expired" | "stale" | "cancelled",
  reason: DeploymentReviewCloseReason | null,
  at: Date,
): Promise<boolean> {
  return (
    (
      await db
        .prepare(
          `UPDATE deployment_reviews SET status = ?, close_reason = ?, closed_at = ?
          WHERE id = ? AND status IN ('pending', 'approved')`,
        )
        .run(status, reason, sqlTime(at), id)
    ).changes > 0
  );
}

/** An approved request was carried out: it points at the deployment it became. */
export async function markReviewDeployed(id: string, at: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE deployment_reviews
        SET status = 'deployed', closed_at = ?,
            deployment_id = (SELECT h.id FROM deployment_history h
                              WHERE h.review_id = deployment_reviews.id AND h.success = 1
                              ORDER BY h.created_at DESC LIMIT 1)
      WHERE id = ? AND status = 'approved'`,
    )
    .run(sqlTime(at), id);
}

/** The accounts that could be asked to look at something on the instance: every enabled one. */
export async function listEnabledUserIds(): Promise<string[]> {
  return ((await db.prepare("SELECT id FROM users WHERE disabled_at IS NULL").all()) as { id: string }[]).map(
    (row) => row.id,
  );
}
