import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { getBackup, setBackupPinned } from "./repository.js";
import { restoreBackup } from "./restore.js";
import { parseBackupSchedule, saveBackupSchedule } from "./schedule.js";
import {
  cancelRunningBackup,
  connectionBackups,
  describeBackup,
  downloadBackup,
  parseTables,
  removeBackup,
  requireBackup,
  requireConnection,
  startManualBackup,
} from "./service.js";

const READ_LIMIT = { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } };
/** Each of these reads or rewrites whole tables of someone's database. */
const HEAVY_LIMIT = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

/**
 * Backups of a connected database. Instance administrators only, like the
 * console they sit next to: a backup is every row of the database in one
 * file, and a restore rewrites them. A project administrator can cause one
 * (the copy taken before a production deployment) but not read it.
 *
 * Taking, cancelling, deleting and downloading one are in `service.ts`, which
 * `/api/v1` shares; the schedule, the pin and the restore are the app's alone.
 */
export function registerBackupRoutes(app: FastifyInstance): void {
  app.get("/api/admin/connections/:id/backups", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    return connectionBackups(id);
  });

  // Answers as soon as the backup has started; the list says how far it is.
  app.post("/api/admin/connections/:id/backups", HEAVY_LIMIT, async (req, reply) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    return reply.status(202).send({ backup: startManualBackup(user, id, req.body, req) });
  });

  app.put("/api/admin/connections/:id/backup-schedule", READ_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const connection = requireConnection(id);
    const settings = parseBackupSchedule(req.body);
    const schedule = saveBackupSchedule(id, settings, user.displayName);
    auditUser(
      user,
      "backup.schedule",
      { type: "connection", id },
      settings.enabled
        ? `${connection.name}: ${settings.frequency} at ${settings.hour}:00, keeping ${settings.keep}`
        : `${connection.name}: off`,
      req,
    );
    return { schedule };
  });

  app.post("/api/admin/backups/:backupId/cancel", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    cancelRunningBackup(backupId);
    return { cancelling: true };
  });

  app.patch("/api/admin/backups/:backupId", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    requireBackup(backupId);
    const { pinned } = (req.body ?? {}) as { pinned?: unknown };
    if (typeof pinned !== "boolean") throw new ApiError("BACKUP_INVALID");
    setBackupPinned(backupId, pinned);
    return { backup: getBackup(backupId) };
  });

  app.delete("/api/admin/backups/:backupId", READ_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    removeBackup(user, backupId, req);
    return { deleted: true };
  });

  app.get("/api/admin/backups/:backupId/download", HEAVY_LIMIT, async (req, reply) => {
    const user = requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    const { fileName, stream } = await downloadBackup(user, backupId, req);
    return reply
      .header("content-type", "application/gzip")
      .header("content-disposition", `attachment; filename="${fileName}"`)
      .send(stream);
  });

  app.post("/api/admin/backups/:backupId/restore", HEAVY_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    const backup = requireBackup(backupId);
    const body = (req.body ?? {}) as {
      connectionId?: unknown;
      tables?: unknown;
      confirmName?: unknown;
      skipSafetyBackup?: unknown;
    };
    // Back where it came from unless another connection is named.
    const targetId = typeof body.connectionId === "string" ? body.connectionId : backup.connectionId;
    const target = requireConnection(targetId ?? "");
    const result = await restoreBackup(backup, target, {
      tables: parseTables(body.tables),
      confirmName: typeof body.confirmName === "string" ? body.confirmName : undefined,
      skipSafetyBackup: body.skipSafetyBackup === true,
      requestedBy: user,
    });
    const rows = result.tables.reduce((sum, table) => sum + table.inserted, 0);
    auditUser(
      user,
      "backup.restore",
      { type: "connection", id: target.id },
      `${result.success ? "restored" : "FAILED restoring"} ${result.tables.length} table(s), ${rows} row(s) into ` +
        `${target.name} from the backup of ${describeBackup(backup)}` +
        (result.safetyBackupId ? "" : " — no safety backup"),
      req,
    );
    return { result };
  });
}
