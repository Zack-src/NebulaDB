import { readProjectFromDoc, type MigrationResolutionMap } from "@athanordb/shared";
import { diffTargetAgainstLive, generateMigrationSql, generateRollbackSql } from "@athanordb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { getConnectionById } from "./repository.js";
import { getDeploymentHistoryEntry, recordDeployment } from "./deploymentHistory.js";

/** Same naive split every driver already uses to *count* statements — kept here too so a history row's `totalStatements` matches what each driver itself reports. */
function countStatements(sql: string): number {
  return sql.split(";").filter((s) => s.trim().length > 0).length;
}

export interface DeployToConnectionResult {
  success: boolean;
  executedStatements: number;
  sql: string;
  rollbackAvailable: boolean;
  irreversibleWarnings: string[];
}

/**
 * The full apply-a-deployment pipeline — introspect the live target,
 * diff it against the project's current canvas, generate forward and
 * rollback SQL, execute, and record history — factored out of the
 * session-authed `apply-deployment` route so the API-key-authed
 * `/api/v1` deploy-trigger endpoint calls the exact same code path
 * instead of a second hand-maintained copy. Throws `CONNECTION_NOT_FOUND`
 * or `MIGRATION_FAILED` (`ApiError`), same as the route did inline.
 */
export async function deployToConnection(
  projectId: string,
  projectName: string,
  connId: string,
  resolutions: MigrationResolutionMap,
  executedByEmail: string,
): Promise<DeployToConnectionResult> {
  const conn = getConnectionById(connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

  const room = getRoom(projectId);
  const canvasProject = readProjectFromDoc(room.doc, projectId, projectName);

  const driver = await createDatabaseDriver(conn);
  try {
    const liveProject = await driver.introspectSchema();
    const diff = diffTargetAgainstLive(liveProject, canvasProject);
    const sql = generateMigrationSql(diff, conn.engine, resolutions);
    const { sql: rollbackSqlRaw, irreversible } = generateRollbackSql(diff, conn.engine, resolutions);
    // The warnings are prepended as SQL comments rather than kept in a
    // separate column: whoever reads `rollbackSql` later (the history list,
    // a manual copy-paste into a client) sees them right next to the
    // statements they qualify, not only if they also thought to check
    // another field.
    const rollbackSql = diff.hasChanges
      ? irreversible.length > 0
        ? `${irreversible.map((w) => `-- WARNING: ${w}`).join("\n")}\n\n${rollbackSqlRaw}`
        : rollbackSqlRaw
      : null;

    const result = await driver.executeMigration(sql);

    recordDeployment({
      projectId,
      connectionId: conn.id,
      connectionName: conn.name,
      environment: conn.environment ?? null,
      engine: conn.engine,
      sql,
      rollbackSql: result.executedStatements > 0 ? rollbackSql : null,
      success: result.success,
      executedStatements: result.executedStatements,
      totalStatements: countStatements(sql),
      error: result.error,
      executedByEmail,
    });

    if (!result.success) {
      throw new ApiError("MIGRATION_FAILED", {
        message: `migration failed: ${result.error}`,
        details: { error: result.error, sql, executedStatements: result.executedStatements },
      });
    }

    return {
      success: true,
      executedStatements: result.executedStatements,
      sql,
      rollbackAvailable: Boolean(rollbackSql),
      irreversibleWarnings: irreversible,
    };
  } finally {
    await driver.close().catch(() => {});
  }
}

export interface RollbackConnectionResult {
  success: boolean;
  executedStatements: number;
}

/**
 * Re-runs the best-effort inverse SQL generated (and stored) at the time a
 * past deployment was applied — factored out of the session-authed
 * `history/:historyId/rollback` route the same way `deployToConnection` was,
 * so the `/api/v1` rollback trigger runs the identical pipeline.
 */
export async function rollbackConnectionDeployment(
  projectId: string,
  connId: string,
  historyId: string,
  executedByEmail: string,
): Promise<RollbackConnectionResult> {
  const entry = getDeploymentHistoryEntry(historyId);
  if (!entry || entry.connectionId !== connId || entry.projectId !== projectId) {
    throw new ApiError("DEPLOYMENT_HISTORY_NOT_FOUND");
  }
  if (!entry.rollbackSql) throw new ApiError("ROLLBACK_NOT_AVAILABLE");
  if (entry.rolledBack) throw new ApiError("ROLLBACK_ALREADY_ATTEMPTED");

  const conn = getConnectionById(connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

  const driver = await createDatabaseDriver(conn);
  try {
    const result = await driver.executeMigration(entry.rollbackSql);

    recordDeployment({
      projectId,
      connectionId: conn.id,
      connectionName: conn.name,
      environment: conn.environment ?? null,
      engine: conn.engine,
      sql: entry.rollbackSql,
      rollbackSql: null, // rolling back a rollback isn't offered
      rollbackOf: entry.id,
      success: result.success,
      executedStatements: result.executedStatements,
      totalStatements: countStatements(entry.rollbackSql),
      error: result.error,
      executedByEmail,
    });

    if (!result.success) {
      throw new ApiError("ROLLBACK_FAILED", {
        message: `rollback failed: ${result.error}`,
        details: { error: result.error, executedStatements: result.executedStatements },
      });
    }

    return { success: true, executedStatements: result.executedStatements };
  } finally {
    await driver.close().catch(() => {});
  }
}
