import type { FastifyInstance } from "fastify";
import type { BackupList, BackupSummary, DatabaseConnectionConfig } from "@athanordb/shared";
import { config } from "../../config.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { getConnectionById } from "../connections/repository.js";
import { deleteBackup, getBackup, getBackupKey, listBackups, setBackupPinned, usedBytes } from "./repository.js";
import { restoreBackup } from "./restore.js";
import { cancelBackup, startBackup } from "./runner.js";
import { backupFileChecksum, openBackupDownload } from "./storage.js";

const READ_LIMIT = { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } };
/** Each of these reads or rewrites whole tables of someone's database. */
const HEAVY_LIMIT = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

const MAX_TABLES = 2000;
const MAX_NOTE = 500;

function loadConnection(id: string): DatabaseConnectionConfig {
  const connection = getConnectionById(id);
  if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
  return connection;
}

function loadBackup(id: string): BackupSummary {
  const backup = getBackup(id);
  if (!backup) throw new ApiError("BACKUP_NOT_FOUND");
  return backup;
}

/** A list of table names, or nothing: the only shape a client may send for "which tables". */
function parseTables(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > MAX_TABLES ||
    !value.every((name) => typeof name === "string" && name.length > 0 && name.length <= 128)
  ) {
    throw new ApiError("BACKUP_INVALID");
  }
  return value.length > 0 ? [...new Set(value as string[])] : undefined;
}

function list(connectionId: string): BackupList {
  return {
    backups: listBackups(connectionId),
    limits: { maxBytes: config.databaseBackupMaxBytes, retentionDays: config.databaseBackupRetentionDays },
    usedBytes: usedBytes(connectionId),
  };
}

const describe = (backup: BackupSummary) =>
  `${backup.connectionName}, ${backup.scope ? `${backup.scope.length} table(s)` : "whole database"}, ${backup.startedAt}`;

/**
 * Backups of a connected database. Instance administrators only, like the
 * console they sit next to: a backup is every row of the database in one
 * file, and a restore rewrites them. A project administrator can cause one
 * (the copy taken before a production deployment) but not read it.
 */
export function registerBackupRoutes(app: FastifyInstance): void {
  app.get("/api/admin/connections/:id/backups", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    loadConnection(id);
    return list(id);
  });

  // Answers as soon as the backup has started; the list says how far it is.
  app.post("/api/admin/connections/:id/backups", HEAVY_LIMIT, async (req, reply) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const connection = loadConnection(id);
    const body = (req.body ?? {}) as { tables?: unknown; note?: unknown };
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > MAX_NOTE)) {
      throw new ApiError("BACKUP_INVALID");
    }
    const { backup } = startBackup({
      connection,
      trigger: "manual",
      tables: parseTables(body.tables),
      note: (body.note as string | undefined)?.trim() || null,
      createdBy: user,
    });
    auditUser(user, "backup.create", { type: "connection", id }, describe(backup), req);
    return reply.status(202).send({ backup });
  });

  app.post("/api/admin/backups/:backupId/cancel", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    const backup = loadBackup(backupId);
    if (backup.status !== "running" || !cancelBackup(backupId)) throw new ApiError("BACKUP_NOT_READY");
    return { cancelling: true };
  });

  app.patch("/api/admin/backups/:backupId", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    loadBackup(backupId);
    const { pinned } = (req.body ?? {}) as { pinned?: unknown };
    if (typeof pinned !== "boolean") throw new ApiError("BACKUP_INVALID");
    setBackupPinned(backupId, pinned);
    return { backup: getBackup(backupId) };
  });

  app.delete("/api/admin/backups/:backupId", READ_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    const backup = loadBackup(backupId);
    // A running one is cancelled, not pulled from under the writer.
    if (backup.status === "running") throw new ApiError("BACKUP_NOT_READY");
    deleteBackup(backupId);
    auditUser(user, "backup.delete", { type: "connection", id: backup.connectionId ?? "" }, describe(backup), req);
    return { deleted: true };
  });

  // The decrypted file, still gzipped: one JSON document per line (see `BackupFileHeader`).
  app.get("/api/admin/backups/:backupId/download", HEAVY_LIMIT, async (req, reply) => {
    const user = requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    const backup = loadBackup(backupId);
    const key = getBackupKey(backupId);
    if (backup.status !== "done" || !key) throw new ApiError("BACKUP_NOT_READY");
    if ((await backupFileChecksum(backupId)) !== backup.checksum) throw new ApiError("BACKUP_CORRUPTED");
    auditUser(user, "backup.download", { type: "connection", id: backup.connectionId ?? "" }, describe(backup), req);
    const name = `${backup.connectionName.replace(/[^A-Za-z0-9._-]+/g, "_") || "backup"}-${backup.startedAt.replace(/[^0-9]/g, "")}`;
    return reply
      .header("content-type", "application/gzip")
      .header("content-disposition", `attachment; filename="${name}.jsonl.gz"`)
      .send(openBackupDownload(backupId, key));
  });

  app.post("/api/admin/backups/:backupId/restore", HEAVY_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { backupId } = req.params as { backupId: string };
    const backup = loadBackup(backupId);
    const body = (req.body ?? {}) as {
      connectionId?: unknown;
      tables?: unknown;
      confirmName?: unknown;
      skipSafetyBackup?: unknown;
    };
    // Back where it came from unless another connection is named.
    const targetId = typeof body.connectionId === "string" ? body.connectionId : backup.connectionId;
    const target = loadConnection(targetId ?? "");
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
        `${target.name} from the backup of ${describe(backup)}` +
        (result.safetyBackupId ? "" : " — no safety backup"),
      req,
    );
    return { result };
  });
}
