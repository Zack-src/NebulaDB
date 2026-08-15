import path from "node:path";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { db } from "./infrastructure/db.js";
import { backupTimestamp, pruneOldBackups, runBackup } from "./infrastructure/backupRunner.js";
import { purgeStaleAttempts } from "./modules/auth/lockout.js";
import { purgeExpiredSessions } from "./modules/auth/session.js";
import { closeAllRooms, flushAllRooms } from "./realtime/room.js";
import { purgeOldAuditEntries } from "./shared/audit.js";

const app = await buildApp();

// Expired rows were never removed, so `sessions` grew forever. Sweep at boot
// and hourly; `unref` so this timer alone can't hold the process open.
const SESSION_SWEEP_MS = 60 * 60 * 1000;
const sweepSessions = () => {
  try {
    const removed = purgeExpiredSessions();
    if (removed > 0) app.log.info(`purged ${removed} expired session(s)`);
    // Same schedule, same rationale: failed-login counters for accounts that
    // are no longer locked and haven't failed in a day carry no information.
    const attempts = purgeStaleAttempts();
    if (attempts > 0) app.log.info(`purged ${attempts} stale login attempt row(s)`);
    // Same schedule again: the audit trail is the one table with no natural
    // ceiling, so its retention has to be enforced somewhere rather than left
    // as a sentence in a policy document.
    const audits = purgeOldAuditEntries(config.auditRetentionDays);
    if (audits > 0) app.log.info(`purged ${audits} audit entry(ies) past the ${config.auditRetentionDays}-day retention`);
  } catch (err) {
    app.log.error({ err }, "session sweep failed");
  }
};
sweepSessions();
const sessionSweepTimer = setInterval(sweepSessions, SESSION_SWEEP_MS);
sessionSweepTimer.unref();

/**
 * Scheduled backups, off unless `ATHANORDB_BACKUP_INTERVAL_HOURS` is set.
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
  const runScheduledBackup = () => {
    try {
      const result = runBackup(path.join(config.backupDir, backupTimestamp()));
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
  backupTimer = setInterval(runScheduledBackup, config.backupIntervalHours * 60 * 60 * 1000);
  backupTimer.unref();
  app.log.info(
    `scheduled backups every ${config.backupIntervalHours}h into ${path.resolve(config.backupDir)} (keeping ${config.backupKeep})`,
  );
}

/**
 * `docker stop` / `docker compose down` send SIGTERM with nothing listening,
 * which dropped in-flight WebSocket connections and any pending debounced
 * snapshot (up to ~2s of edits). Stop accepting new work, flush every live
 * room to SQLite, then close the database.
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
  if (backupTimer) clearInterval(backupTimer);
  try {
    const flushed = flushAllRooms();
    if (flushed > 0) app.log.info(`flushed ${flushed} room snapshot(s)`);
    closeAllRooms();
    await app.close();
    db.close();
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
  try {
    flushAllRooms();
  } catch (flushErr) {
    app.log.error({ err: flushErr }, "flush after uncaught exception failed");
  }
});

process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "unhandled promise rejection");
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
