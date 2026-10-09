import path from "node:path";
import type { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";
import type { BackupList, BackupSummary, DatabaseConnectionConfig } from "@nebuladb/shared";
import { config } from "../../config.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { connectionOwner, getConnectionById } from "../connections/repository.js";
import {
  deleteBackup,
  getBackup,
  getBackupDirectory,
  getBackupKey,
  listBackups,
  setBackupDirectory,
  usedBytes,
} from "./repository.js";
import { cancelBackup, startBackup } from "./runner.js";
import { getBackupSchedule } from "./schedule.js";
import { backupFileChecksum, openBackupDownload, probeBackupDirectory } from "./storage.js";

/**
 * What can be done with a database's backups, once — the app's routes and
 * `/api/v1` both come here, so the two cannot disagree on a rule. Who may do
 * it (instance administrators) is the routes' to check.
 */

type Actor = { id: string; email: string; displayName: string };

const MAX_TABLES = 2000;
const MAX_NOTE = 500;
const MAX_DIRECTORY = 1024;

const destinationOf = (connectionId: string) => ({
  directory: getBackupDirectory(connectionId),
  defaultDirectory: path.resolve(config.databaseBackupDir),
});

/**
 * Where a connection's next backups are written: a folder of the server —
 * local, or a network share mounted there (or a `\\server\share` path on
 * Windows) — or `null` for the instance's own. Tried before it is kept: a
 * folder nothing can be written to is refused with the system's reason. The
 * backups already taken stay where they are, and stay readable.
 */
export function saveBackupDestination(user: Actor, connectionId: string, rawBody: unknown, req: FastifyRequest) {
  const connection = requireConnection(connectionId);
  const { directory: raw } = (rawBody ?? {}) as { directory?: unknown };
  let directory: string | null = null;
  if (raw !== null && raw !== undefined && raw !== "") {
    if (typeof raw !== "string" || raw.length > MAX_DIRECTORY || raw.includes("\0") || !path.isAbsolute(raw.trim())) {
      throw new ApiError("BACKUP_DESTINATION_INVALID");
    }
    directory = path.normalize(raw.trim());
    try {
      probeBackupDirectory(directory);
    } catch (err) {
      throw new ApiError("BACKUP_DESTINATION_UNUSABLE", {
        details: { reason: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  if (directory !== getBackupDirectory(connectionId)) {
    setBackupDirectory(connectionId, directory);
    auditUser(
      user,
      "backup.destination",
      { type: "connection", id: connectionId },
      `${connection.name}: ${directory ?? "instance default"}`,
      req,
    );
  }
  return destinationOf(connectionId);
}

export function requireConnection(id: string): DatabaseConnectionConfig {
  const connection = getConnectionById(id);
  if (!connection || connectionOwner(id)) throw new ApiError("CONNECTION_NOT_FOUND");
  return connection;
}

export function requireBackup(id: string): BackupSummary {
  const backup = getBackup(id);
  if (!backup) throw new ApiError("BACKUP_NOT_FOUND");
  return backup;
}

/** A list of table names, or nothing: the only shape a client may send for "which tables". */
export function parseTables(value: unknown): string[] | undefined {
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

/** How a backup reads in the audit log. */
export const describeBackup = (backup: BackupSummary) =>
  `${backup.connectionName}, ${backup.scope ? `${backup.scope.length} table(s)` : "whole database"}, ${backup.startedAt}`;

export function connectionBackups(connectionId: string): BackupList {
  requireConnection(connectionId);
  return {
    backups: listBackups(connectionId),
    limits: { maxBytes: config.databaseBackupMaxBytes, retentionDays: config.databaseBackupRetentionDays },
    usedBytes: usedBytes(connectionId),
    schedule: getBackupSchedule(connectionId),
    destination: destinationOf(connectionId),
  };
}

/** Returns as soon as the backup has started; its record says how far it is. */
export function startManualBackup(
  user: Actor,
  connectionId: string,
  rawBody: unknown,
  req: FastifyRequest,
): BackupSummary {
  const connection = requireConnection(connectionId);
  const body = (rawBody ?? {}) as { tables?: unknown; note?: unknown };
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
  auditUser(user, "backup.create", { type: "connection", id: connectionId }, describeBackup(backup), req);
  return backup;
}

export function cancelRunningBackup(backupId: string): void {
  const backup = requireBackup(backupId);
  if (backup.status !== "running" || !cancelBackup(backupId)) throw new ApiError("BACKUP_NOT_READY");
}

export function removeBackup(user: Actor, backupId: string, req: FastifyRequest): void {
  const backup = requireBackup(backupId);
  // A running one is cancelled, not pulled from under the writer.
  if (backup.status === "running") throw new ApiError("BACKUP_NOT_READY");
  deleteBackup(backupId);
  auditUser(user, "backup.delete", { type: "connection", id: backup.connectionId ?? "" }, describeBackup(backup), req);
}

/** The decrypted file, still gzipped: one JSON document per line (see `BackupFileHeader`). */
export async function downloadBackup(
  user: Actor,
  backupId: string,
  req: FastifyRequest,
): Promise<{ fileName: string; stream: Readable }> {
  const backup = requireBackup(backupId);
  const key = getBackupKey(backupId);
  if (backup.status !== "done" || !key) throw new ApiError("BACKUP_NOT_READY");
  if ((await backupFileChecksum(backupId)) !== backup.checksum) throw new ApiError("BACKUP_CORRUPTED");
  auditUser(
    user,
    "backup.download",
    { type: "connection", id: backup.connectionId ?? "" },
    describeBackup(backup),
    req,
  );
  const name = `${backup.connectionName.replace(/[^A-Za-z0-9._-]+/g, "_") || "backup"}-${backup.startedAt.replace(/[^0-9]/g, "")}`;
  return { fileName: `${name}.jsonl.gz`, stream: openBackupDownload(backupId, key) };
}
