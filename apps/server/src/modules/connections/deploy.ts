import crypto from "node:crypto";
import { notifyFollowers } from "../notifications/repository.js";
import {
  readProjectFromDoc,
  type AcceptedRisk,
  type DatabaseConnectionConfig,
  type DeploymentReviewCloseReason,
  type MigrationResolutionMap,
  type Project,
} from "@nebuladb/shared";
import {
  diffTargetAgainstLive,
  generateMigrationSql,
  generateRollbackSql,
  type MigrationDiff,
} from "@nebuladb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { saveReferenceFingerprint, type FingerprintSource } from "./drift.js";
import type { DatabaseDriver } from "./drivers/interface.js";
import { getProjectConnection } from "./repository.js";
import { getEnvironment } from "../environments/repository.js";
import { analyzeDeploymentRisks, settleRisks } from "./riskAnalysis.js";
import { applySeeds, assertSeedsDeployable, prepareSeeds, type PreparedSeeds } from "../seeds/deploySeeds.js";
import type { SeedResult } from "@nebuladb/shared";
import { backupOrRefuse } from "../backups/runner.js";

const RISK_NOTE_MAX = 1000;

function isProductionStage(conn: { environmentId?: string | null }): boolean {
  return Boolean(conn.environmentId && getEnvironment(conn.environmentId)?.production);
}

/** A stage whose protection is `review`: a deployment to it carries an approved review request, or does not run. */
export function stageAsksForReview(conn: { environmentId?: string | null }): boolean {
  return Boolean(conn.environmentId && getEnvironment(conn.environmentId)?.protection === "review");
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
import { assertStageOrder, schemaHashOf } from "../pipeline/pipeline.js";
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
  // The deployment history is read by those who may deploy, so is this.
  notifyFollowers(
    projectId,
    "deployment",
    { kind, connection: conn.name, environment: conn.environment ?? null, success: result.success, by: executedBy },
    { actor: { email: executedBy }, needs: "deploy" },
  );
}

/**
 * After a successful deployment or rollback the database is, by construction,
 * what Nebula made it: read it back and keep that as the reference later
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

/** The seeds a deployment would insert, as one value: a request for review freezes it, a deployment compares. */
function seedsHashOf(seeds: PreparedSeeds | null): string | null {
  if (!seeds || seeds.seeds.length === 0) return null;
  const hash = crypto.createHash("sha256");
  for (const { seed, table } of seeds.seeds) hash.update(JSON.stringify([table.name, seed.options, seed.content]));
  return hash.digest("hex");
}

/** One risk as a reviewer read it: what it is about and the answer given — not the row count, which moves on its own. */
const riskIdentity = (risk: AcceptedRisk) =>
  [risk.type, risk.tableName, risk.columnName ?? "", risk.detail ?? "", risk.strategy].join("\u0000");

interface DeploymentPlan {
  diff: MigrationDiff;
  acceptedRisks: AcceptedRisk[];
  /** `null` when the seeds are left out. */
  seeds: PreparedSeeds | null;
  sql: string;
}

/**
 * What a deployment would run against the target as it is now: the diff, the
 * risks settled with the answers given, the seeds, the SQL. Refuses what a
 * deployment refuses (a risk left on "cancel", a seed that cannot go in) —
 * the same for the deployment itself and for the request that freezes it for
 * a review.
 */
async function planDeployment(
  driver: DatabaseDriver,
  projectId: string,
  conn: DatabaseConnectionConfig,
  canvasProject: Project,
  resolutions: MigrationResolutionMap,
  skipSeeds: boolean,
): Promise<DeploymentPlan> {
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
  const seeds = skipSeeds ? null : prepareSeeds(projectId, canvasProject);
  if (seeds) assertSeedsDeployable(seeds);
  return { diff, acceptedRisks, seeds, sql: generateMigrationSql(diff, conn.engine, resolutions) };
}

/** What a review request froze, as far as a deployment has to match it. */
export interface ReviewedPlan {
  /** The request's id, kept with the deployment. */
  id: string;
  schemaHash: string;
  sql: string;
  risks: AcceptedRisk[];
  seedsHash: string | null;
}

/**
 * An approval is for what was read. The plan made now, with the answers the
 * request froze, has to be the one that was approved: same SQL, same risks
 * with the same answers, same seeds. Otherwise `DEPLOYMENT_REVIEW_STALE`,
 * naming what moved — the schema when its hash did, the database when the
 * schema is the same and the SQL is not.
 */
function assertStillAsReviewed(reviewed: ReviewedPlan, schemaHash: string, plan: DeploymentPlan): void {
  const sameRisks =
    plan.acceptedRisks.length === reviewed.risks.length &&
    plan.acceptedRisks.map(riskIdentity).sort().join("\n") === reviewed.risks.map(riskIdentity).sort().join("\n");
  const reason: DeploymentReviewCloseReason | null =
    plan.sql !== reviewed.sql
      ? schemaHash !== reviewed.schemaHash
        ? "schema"
        : "database"
      : !sameRisks
        ? "risks"
        : seedsHashOf(plan.seeds) !== reviewed.seedsHash
          ? "seeds"
          : null;
  if (reason) throw new ApiError("DEPLOYMENT_REVIEW_STALE", { details: { reason } });
}

export interface FrozenDeployment {
  connection: DatabaseConnectionConfig;
  schemaHash: string;
  sql: string;
  acceptedRisks: AcceptedRisk[];
  seedsHash: string | null;
}

/**
 * Prepares a deployment exactly as `deployToConnection` would, and stops
 * before anything runs: what a review request keeps. Everything that would
 * refuse the deployment for what it *is* refuses the request too (read-only
 * connection, lint errors, a risk left on "cancel", broken seeds). The stage
 * order is not asked here: it is about the other stages, which normally move
 * between a request and its deployment, and is checked when deploying.
 */
export async function freezeDeployment(
  projectId: string,
  projectName: string,
  connId: string,
  resolutions: MigrationResolutionMap,
  options: { skipSeeds?: boolean } = {},
): Promise<FrozenDeployment> {
  const conn = getProjectConnection(projectId, connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");
  if (conn.readOnly) throw new ApiError("CONNECTION_READ_ONLY");
  if (!stageAsksForReview(conn)) throw new ApiError("DEPLOYMENT_REVIEW_NOT_REQUIRED");

  const writtenProject = readProjectFromDoc(getRoom(projectId).doc, projectId, projectName);
  assertLintAllowsDeployment(writtenProject, getLintSettings(projectId));
  const canvasProject = schemaForConnection(writtenProject, conn);

  const driver = await createDatabaseDriver(conn);
  try {
    const plan = await planDeployment(driver, projectId, conn, canvasProject, resolutions, options.skipSeeds === true);
    if (!plan.diff.hasChanges && !(plan.seeds && plan.seeds.seeds.length > 0)) {
      throw new ApiError("DEPLOYMENT_REVIEW_NOTHING_TO_DEPLOY");
    }
    return {
      connection: conn,
      schemaHash: schemaHashOf(writtenProject),
      sql: plan.sql,
      acceptedRisks: plan.acceptedRisks,
      seedsHash: seedsHashOf(plan.seeds),
    };
  } finally {
    await driver.close().catch(() => {});
  }
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
    /** Deploy although an earlier stage is not level — the caller has checked who asks and why. */
    skipStageOrder?: boolean;
    /**
     * The approved review request this deployment carries out — the caller has
     * checked that it is approved, by whom and until when. Required on a stage
     * whose protection is `review`; the plan must still be the one it froze.
     */
    review?: ReviewedPlan;
  } = {},
): Promise<DeployToConnectionResult> {
  const { confirmName } = options;
  const conn = getProjectConnection(projectId, connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");
  if (conn.readOnly) throw new ApiError("CONNECTION_READ_ONLY");
  // Here rather than in a route: the editor, the deployments tab and the
  // public API all end up in this function, and none of them gets around it.
  if (stageAsksForReview(conn) && !options.review) {
    throw new ApiError("DEPLOYMENT_REVIEW_REQUIRED", {
      details: { connection: conn.name, environment: conn.environment ?? null },
    });
  }
  assertProductionConfirmed(conn, confirmName);

  const room = getRoom(projectId);
  const writtenProject = readProjectFromDoc(room.doc, projectId, projectName);
  // Before a connection is even opened: nothing of the target is needed to
  // know the schema breaks the project's own rules, or names a variable the
  // stage does not define.
  assertLintAllowsDeployment(writtenProject, getLintSettings(projectId));
  const schemaHash = schemaHashOf(writtenProject);
  assertStageOrder(projectId, conn, schemaHash, options.skipStageOrder === true);
  const canvasProject = schemaForConnection(writtenProject, conn);

  const driver = await createDatabaseDriver(conn);
  try {
    const plan = await planDeployment(driver, projectId, conn, canvasProject, resolutions, options.skipSeeds === true);
    if (options.review) assertStillAsReviewed(options.review, schemaHash, plan);
    const { diff, acceptedRisks, seeds, sql } = plan;
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
      schemaHash,
      reviewId: options.review?.id ?? null,
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
