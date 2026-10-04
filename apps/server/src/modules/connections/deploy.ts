import { readProjectFromDoc, type MigrationResolutionMap } from "@athanordb/shared";
import { diffTargetAgainstLive, generateMigrationSql, generateRollbackSql } from "@athanordb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { saveReferenceFingerprint, type FingerprintSource } from "./drift.js";
import type { DatabaseDriver } from "./drivers/interface.js";
import { getProjectConnection } from "./repository.js";
import { getEnvironment } from "../environments/repository.js";
import { analyzeDeploymentRisks, settleRisks } from "./riskAnalysis.js";
import { applySeeds, assertSeedsDeployable, prepareSeeds } from "../seeds/deploySeeds.js";
import type { SeedResult } from "@athanordb/shared";
import { backupOrRefuse } from "../backups/runner.js";

const RISK_NOTE_MAX = 1000;

function isProductionStage(conn: { environmentId?: string | null }): boolean {
  return Boolean(conn.environmentId && getEnvironment(conn.environmentId)?.production);
}

/**
 * A connection on the production stage is only written to by someone who
 * typed its name: the same rule for the editor, the deployments tab and the
 * public API, checked here rather than trusted to a dialog.
 */
function assertProductionConfirmed(
  conn: { name: string; environmentId?: string | null },
  confirmName: string | undefined,
): void {
  const stage = conn.environmentId ? getEnvironment(conn.environmentId) : null;
  if (!stage?.production) return;
  if (typeof confirmName !== "string" || confirmName.trim() !== conn.name.trim()) {
    throw new ApiError("PRODUCTION_CONFIRMATION_REQUIRED", {
      details: { connection: conn.name, environment: stage.name },
    });
  }
}
import { getDeploymentHistoryEntry, recordDeployment } from "./deploymentHistory.js";
import { schemaForConnection } from "../environments/variables.js";
import { assertLintAllowsDeployment } from "../lint/check.js";
import { getLintSettings } from "../lint/repository.js";
import { emitWebhookEvent } from "../webhooks/dispatcher.js";

/** `deployment.completed` for the project's webhooks — success or failure, deploy or rollback. */
function notifyDeployment(
  projectId: string,
  conn: { name: string; environment?: string | null; engine: string },
  kind: "deploy" | "rollback",
  result: { success: boolean; executedStatements: number; error?: string | null },
  executedBy: string,
): void {
  emitWebhookEvent(projectId, "deployment.completed", {
    kind,
    connectionName: conn.name,
    environment: conn.environment ?? null,
    engine: conn.engine,
    success: result.success,
    executedStatements: result.executedStatements,
    error: result.error ?? null,
    executedBy,
  });
}

/**
 * After a successful deployment or rollback the database is, by construction,
 * what Athanor made it: read it back and keep that as the reference later
 * drift is measured against. Best effort — the deployment has already
 * happened, and failing it now over a bookkeeping read would be a lie.
 */
async function rememberDeployedState(
  driver: DatabaseDriver,
  projectId: string,
  connectionId: string,
  source: FingerprintSource,
): Promise<void> {
  try {
    saveReferenceFingerprint(projectId, connectionId, await driver.introspectSchema(), source);
  } catch (err) {
    console.error("[drift] could not record the reference fingerprint:", err);
  }
}

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
  /** What each seeded table got; a failure there does not undo the DDL, which already ran. */
  seedReport: SeedResult[];
  /** The backup of the database taken just before, when there was one. */
  backupId: string | null;
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
  options: {
    /** The connection's name, retyped — required when it is on the production stage. */
    confirmName?: string;
    /** Why the plan's risks are accepted — kept with the deployment. */
    riskNote?: string;
    /** Leave the tables' seeds out of this deployment. */
    skipSeeds?: boolean;
    /**
     * Back the database up before changing it. Left unset, that is done on
     * the production stage and nowhere else; `false` is the explicit way to
     * deploy to production without one.
     */
    backupBefore?: boolean;
  } = {},
): Promise<DeployToConnectionResult> {
  const { confirmName } = options;
  const conn = getProjectConnection(projectId, connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");
  if (conn.readOnly) throw new ApiError("CONNECTION_READ_ONLY");
  assertProductionConfirmed(conn, confirmName);

  const room = getRoom(projectId);
  const writtenProject = readProjectFromDoc(room.doc, projectId, projectName);
  // Before a connection is even opened: nothing of the target is needed to
  // know the schema breaks the project's own rules, or names a variable the
  // stage does not define.
  assertLintAllowsDeployment(writtenProject, getLintSettings(projectId));
  const canvasProject = schemaForConnection(writtenProject, conn);

  const driver = await createDatabaseDriver(conn);
  try {
    const liveProject = await driver.introspectSchema();
    const diff = diffTargetAgainstLive(liveProject, canvasProject);
    // Measured again here, whatever the plan said: the data may have moved
    // since, and an API caller may never have looked at a plan at all.
    const acceptedRisks = settleRisks(
      await analyzeDeploymentRisks(driver, diff, conn.engine),
      resolutions,
      isProductionStage(conn),
    );
    // Seeds are checked before anything runs: a seed that cannot go in must
    // not leave the database half-deployed.
    const seeds = options.skipSeeds ? null : prepareSeeds(projectId, canvasProject);
    if (seeds) assertSeedsDeployable(seeds);
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

    // Last thing before the database changes, once everything that could
    // refuse the deployment has had its say. A backup that does not complete
    // refuses it too (`BACKUP_FAILED`): a safety copy that silently was not
    // taken is worse than none asked for.
    const willWrite = diff.hasChanges || Boolean(seeds && seeds.seeds.length > 0);
    const backup =
      willWrite && (options.backupBefore ?? isProductionStage(conn))
        ? await backupOrRefuse({
            connection: conn,
            trigger: "pre-deployment",
            note: `before a deployment of ${projectName} by ${executedByEmail}`,
          })
        : null;

    const result = await driver.executeMigration(sql);
    const seedReport: SeedResult[] =
      result.success && seeds && seeds.seeds.length > 0 ? await applySeeds(driver, seeds, conn.engine) : [];

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
      acceptedRisks,
      riskNote: typeof options.riskNote === "string" ? options.riskNote.slice(0, RISK_NOTE_MAX) : null,
      seedReport,
      backupId: backup?.id ?? null,
    });
    notifyDeployment(projectId, conn, "deploy", result, executedByEmail);

    if (!result.success) {
      throw new ApiError("MIGRATION_FAILED", {
        message: `migration failed: ${result.error}`,
        details: { error: result.error, sql, executedStatements: result.executedStatements },
      });
    }

    await rememberDeployedState(driver, projectId, conn.id, "deploy");

    return {
      success: true,
      executedStatements: result.executedStatements,
      sql,
      rollbackAvailable: Boolean(rollbackSql),
      irreversibleWarnings: irreversible,
      seedReport,
      backupId: backup?.id ?? null,
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
  /** As for `deployToConnection`. */
  confirmName?: string,
): Promise<RollbackConnectionResult> {
  const entry = getDeploymentHistoryEntry(historyId);
  if (!entry || entry.connectionId !== connId || entry.projectId !== projectId) {
    throw new ApiError("DEPLOYMENT_HISTORY_NOT_FOUND");
  }
  if (!entry.rollbackSql) throw new ApiError("ROLLBACK_NOT_AVAILABLE");
  if (entry.rolledBack) throw new ApiError("ROLLBACK_ALREADY_ATTEMPTED");

  const conn = getProjectConnection(projectId, connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");
  if (conn.readOnly) throw new ApiError("CONNECTION_READ_ONLY");
  assertProductionConfirmed(conn, confirmName);

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
    notifyDeployment(projectId, conn, "rollback", result, executedByEmail);

    if (!result.success) {
      throw new ApiError("ROLLBACK_FAILED", {
        message: `rollback failed: ${result.error}`,
        details: { error: result.error, executedStatements: result.executedStatements },
      });
    }

    await rememberDeployedState(driver, projectId, conn.id, "rollback");

    return { success: true, executedStatements: result.executedStatements };
  } finally {
    await driver.close().catch(() => {});
  }
}
