import "./loadEnv.js";
import path from "node:path";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { db } from "./infrastructure/db.js";
import { backupTimestamp, pruneOldBackups, runBackup } from "./infrastructure/backupRunner.js";
import { purgeStaleAttempts } from "./modules/auth/lockout.js";
import { purgeExpiredResetTokens } from "./modules/auth/passwordReset.js";
import { startWebhookWorker } from "./modules/webhooks/dispatcher.js";
import { startConnectionHealthChecks } from "./modules/dbAdmin/health.js";
import { runDueMonitoring } from "./modules/monitoring/monitor.js";
import { purgeOldActivity, runDueActivitySamples } from "./modules/dbMonitor/activity.js";
import { failInterruptedBackups, purgeExpiredBackups } from "./modules/backups/repository.js";
import { runDueBackupSchedules } from "./modules/backups/schedule.js";
import { scheduleJob, stopAllJobs } from "./infrastructure/scheduler.js";
import { purgeOldDeliveries } from "./modules/webhooks/repository.js";
import { purgeExpiredSessions } from "./modules/auth/session.js";
import { purgeExpiredMfaChallenges } from "./modules/auth/totpRepository.js";
import { closeAllRooms, flushAllRooms } from "./realtime/roomRegistry.js";
import { purgeOldAuditEntries } from "./shared/audit.js";
import { purgeOldQueryStats } from "./modules/dbAdmin/queryStats.js";
import { recordError, tallyErrorForMetrics } from "./shared/errorLog.js";

const app = await buildApp();

// Expired rows were never removed, so `sessions` grew forever. Sweep at boot
// and hourly; `unref` so this timer alone can't hold the process open.
const SESSION_SWEEP_MS = 60 * 60 * 1000;
const sweepSessions = async () => {
  try {
    const removed = await purgeExpiredSessions();
    if (removed > 0) app.log.info(`purged ${removed} expired session(s)`);
    // Same schedule, same rationale: failed-login counters for accounts that
    // are no longer locked and haven't failed in a day carry no information.
    const attempts = await purgeStaleAttempts();
    if (attempts > 0) app.log.info(`purged ${attempts} stale login attempt row(s)`);
    // Same schedule again: the audit trail is the one table with no natural
    // ceiling, so its retention has to be enforced somewhere rather than left
    // as a sentence in a policy document.
    const audits = await purgeOldAuditEntries(config.auditRetentionDays);
    if (audits > 0)
      app.log.info(`purged ${audits} audit entry(ies) past the ${config.auditRetentionDays}-day retention`);
    // MFA challenges are already short-lived (5 minutes) and `getMfaChallenge`
    // refuses an expired one on its own, but an abandoned login (password
    // step completed, second factor never entered) otherwise leaves a dead
    // row behind forever.
    const challenges = await purgeExpiredMfaChallenges();
    if (challenges > 0) app.log.info(`purged ${challenges} expired MFA challenge(s)`);
    const resetTokens = await purgeExpiredResetTokens();
    if (resetTokens > 0) app.log.info(`purged ${resetTokens} expired/used password reset token(s)`);
    const queryStats = await purgeOldQueryStats(config.queryStatsRetentionDays);
    if (queryStats > 0) app.log.info(`purged ${queryStats} SQL console statistic row(s)`);
    const activity = await purgeOldActivity(config.dbActivityRetentionDays);
    if (activity > 0) app.log.info(`purged ${activity} database-side activity row(s)`);
    const deliveries = await purgeOldDeliveries();
    if (deliveries > 0) app.log.info(`purged ${deliveries} webhook delivery log row(s) older than 30 days`);
  } catch (err) {
    app.log.error({ err }, "session sweep failed");
  }
};
await sweepSessions();
const sessionSweepTimer = setInterval(() => void sweepSessions(), SESSION_SWEEP_MS);
sessionSweepTimer.unref();

// Webhook retries: deliveries whose next attempt has come due. First
// attempts don't wait for this — they're sent as soon as they're queued.
startWebhookWorker();
startConnectionHealthChecks(config.connectionHealthIntervalMinutes);
// The watch over projects' databases: each project says how often; this only looks for who is due.
scheduleJob("drift-monitor", 60_000, runDueMonitoring);
// Database-side sessions of the connections an administrator asked to sample.
scheduleJob("db-activity-samples", 60_000, runDueActivitySamples);
// Backups of connected databases: whatever a restart cut short is marked failed, and what is past its retention goes.
const interrupted = await failInterruptedBackups();
if (interrupted > 0) app.log.warn(`${interrupted} database backup(s) were interrupted by the restart`);
// Each connection's schedule says when; this only looks for whose hour has come.
scheduleJob("database-backup-schedules", 60_000, () => runDueBackupSchedules().then(() => {}));
scheduleJob("database-backup-retention", 60 * 60 * 1000, async () => {
  const purged = await purgeExpiredBackups();
  if (purged > 0) app.log.info(`purged ${purged} database backup(s) past their retention`);
});

/**
 * Scheduled backups, off unless `NEBULADB_BACKUP_INTERVAL_HOURS` is set.
 *
 * `backup.ts` has always worked, but nothing in a running deployment ever
 * called it — a backup that depends on someone remembering the command is a
 * backup most instances don't actually have. Old directories are pruned so
 * this doesn't slowly fill the volume the database itself lives on.
 *
 * Deliberately not run at boot: a restart loop would otherwise produce a
 * backup per crash and prune away the older, *good* ones.
 */
let backupTimer: NodeJS.Timeout | null = null;
if (config.backupIntervalHours > 0) {
  const runScheduledBackup = async () => {
    try {
      const result = await runBackup(path.join(config.backupDir, backupTimestamp()));
      const pruned = pruneOldBackups(config.backupDir, config.backupKeep);
      app.log.info(
        `backup: ${result.backedUp} project(s) written to ${result.dir}` +
          `${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}` +
          `${pruned > 0 ? `, ${pruned} old backup(s) pruned` : ""}`,
      );
    } catch (err) {
      // A failed backup must never take the server down with it.
      app.log.error({ err }, "scheduled backup failed");
    }
  };
  backupTimer = setInterval(() => void runScheduledBackup(), config.backupIntervalHours * 60 * 60 * 1000);
  backupTimer.unref();
  app.log.info(
    `scheduled backups every ${config.backupIntervalHours}h into ${path.resolve(config.backupDir)} (keeping ${config.backupKeep})`,
  );
}

/**
 * `docker stop` / `docker compose down` send SIGTERM with nothing listening,
 * which dropped in-flight WebSocket connections and any pending debounced
 * snapshot (up to ~2s of edits). Stop accepting new work, flush every live
 * room to the database, then close the pool.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received — shutting down`);

  // Hard ceiling: a stuck close must not leave the container hanging until the
  // orchestrator SIGKILLs it, which is exactly the unflushed-state case above.
  const timer = setTimeout(() => {
    app.log.error("shutdown timed out — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  clearInterval(sessionSweepTimer);
  stopAllJobs();
  if (backupTimer) clearInterval(backupTimer);
  try {
    const flushed = await flushAllRooms();
    if (flushed > 0) app.log.info(`flushed ${flushed} room snapshot(s)`);
    await closeAllRooms();
    await app.close();
    await db.close();
    app.log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown(signal));
}

/**
 * Last-resort guards. Without them a single uncaught throw anywhere (a WS
 * `message`/`close` handler, a stray promise) takes the whole process down —
 * and with it every other project's live session, not just the one that
 * failed. State is snapshotted immediately so nothing is lost if the process
 * does go on to die, but the process is deliberately kept alive: for a
 * collaborative server, dropping everyone is strictly worse than continuing in
 * a possibly-degraded state, and every known failure path here is already
 * isolated per-connection.
 */
process.on("uncaughtException", (err) => {
  app.log.error({ err }, "uncaught exception — server kept alive, state flushed");
  tallyErrorForMetrics("server");
  // Neither of these may reject: a rejection raised from inside these two
  // handlers would come straight back to the one below, and around again.
  // `recordError` and a room's flush both log their own failures.
  void recordError("server", err.message, { stack: err.stack, context: "uncaughtException" });
  flushAllRooms().catch((flushErr: unknown) => {
    app.log.error({ err: flushErr }, "flush after uncaught exception failed");
  });
});

process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "unhandled promise rejection");
  tallyErrorForMetrics("server");
  void recordError("server", reason instanceof Error ? reason.message : String(reason), {
    stack: reason instanceof Error ? reason.stack : undefined,
    context: "unhandledRejection",
  });
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
