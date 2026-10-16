import crypto from "node:crypto";
import type { BackupStatus, BackupSummary, BackupTableInfo, BackupTrigger, DatabaseEngine } from "@nebuladb/shared";
import { config } from "../../config.js";
import { db } from "../../infrastructure/db.js";
import { removeBackupFile, type StoredBackup } from "./storage.js";

interface BackupRow {
  id: string;
  connection_id: string | null;
  connection_name: string;
  engine: string;
  trigger: string;
  status: string;
  scope_json: string | null;
  tables_json: string;
  tables_total: number;
  rows: number;
  size_bytes: number | null;
  checksum: string | null;
  key_encrypted: string | null;
  error: string | null;
  note: string | null;
  created_by_name: string | null;
  started_at: string;
  finished_at: string | null;
  pinned: number;
  expires_at: string | null;
}

/**
 * `expires_at` is computed, not stored: changing the retention applies to the
 * backups already there. A scheduled backup has none — its schedule keeps the
 * last N of them instead (`pruneScheduledBackups`).
 */
function selectBackups(where: string): string {
  const expires =
    config.databaseBackupRetentionDays > 0
      ? `CASE WHEN pinned = 1 OR status = 'running' OR (trigger = 'scheduled' AND status = 'done') THEN NULL
              ELSE utc_shift(started_at, '+${config.databaseBackupRetentionDays} days') END`
      : "NULL";
  return `SELECT *, ${expires} AS expires_at FROM backups WHERE ${where}`;
}

function rowToSummary(row: BackupRow): BackupSummary {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    engine: row.engine as DatabaseEngine,
    trigger: row.trigger as BackupTrigger,
    status: row.status as BackupStatus,
    scope: row.scope_json ? (JSON.parse(row.scope_json) as string[]) : null,
    tables: JSON.parse(row.tables_json) as BackupTableInfo[],
    tablesTotal: row.tables_total,
    rows: row.rows,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    error: row.error,
    note: row.note,
    createdByName: row.created_by_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    pinned: row.pinned === 1,
    expiresAt: row.expires_at,
  };
}

export interface NewBackup {
  connectionId: string;
  connectionName: string;
  engine: DatabaseEngine;
  trigger: BackupTrigger;
  scope: string[] | null;
  note: string | null;
  createdBy: { id: string; displayName: string } | null;
}

export async function insertBackup(input: NewBackup): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO backups (id, connection_id, connection_name, engine, trigger, status, scope_json, note, created_by, created_by_name, dir)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, (SELECT backup_dir FROM db_connections WHERE id = ?))`,
    )
    .run(
      id,
      input.connectionId,
      input.connectionName,
      input.engine,
      input.trigger,
      input.scope ? JSON.stringify(input.scope) : null,
      input.note,
      input.createdBy?.id ?? null,
      input.createdBy?.displayName ?? null,
      input.connectionId,
    );
  return id;
}

/** The folder a connection's next backups go to; `null`: the instance's own. */
export async function getBackupDirectory(connectionId: string): Promise<string | null> {
  const row = (await db.prepare("SELECT backup_dir FROM db_connections WHERE id = ?").get(connectionId)) as
    { backup_dir: string | null } | undefined;
  return row?.backup_dir ?? null;
}

export async function setBackupDirectory(connectionId: string, directory: string | null): Promise<void> {
  await db.prepare("UPDATE db_connections SET backup_dir = ? WHERE id = ?").run(directory, connectionId);
}

export async function getBackup(id: string): Promise<BackupSummary | null> {
  const row = (await db.prepare(selectBackups("id = ?")).get(id)) as BackupRow | undefined;
  return row ? rowToSummary(row) : null;
}

/** The encrypted key of a finished backup's file; `null` while it runs or after it failed. */
export async function getBackupKey(id: string): Promise<string | null> {
  const row = (await db.prepare("SELECT key_encrypted FROM backups WHERE id = ? AND status = 'done'").get(id)) as
    { key_encrypted: string | null } | undefined;
  return row?.key_encrypted ?? null;
}

export async function listBackups(connectionId: string, limit = 100): Promise<BackupSummary[]> {
  const rows = (await db
    .prepare(`${selectBackups("connection_id = ?")} ORDER BY started_at DESC, seq DESC LIMIT ?`)
    .all(connectionId, limit)) as BackupRow[];
  return rows.map(rowToSummary);
}

export async function usedBytes(connectionId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM backups WHERE connection_id = ? AND status = 'done'")
    .get(connectionId)) as { total: number };
  return row.total;
}

export async function hasRunningBackup(connectionId: string): Promise<boolean> {
  return (
    (await db
      .prepare("SELECT 1 FROM backups WHERE connection_id = ? AND status = 'running' LIMIT 1")
      .get(connectionId)) !== undefined
  );
}

export async function recordProgress(
  id: string,
  tablesTotal: number,
  tables: BackupTableInfo[],
  rows: number,
): Promise<void> {
  await db
    .prepare("UPDATE backups SET tables_total = ?, tables_json = ?, rows = ? WHERE id = ?")
    .run(tablesTotal, JSON.stringify(tables), rows, id);
}

export async function markBackupDone(id: string, stored: StoredBackup): Promise<void> {
  await db
    .prepare(
      `UPDATE backups SET status = 'done', size_bytes = ?, checksum = ?, key_encrypted = ?, finished_at = utc_now()
      WHERE id = ?`,
    )
    .run(stored.sizeBytes, stored.checksum, stored.keyEncrypted, id);
}

export async function markBackupEnded(id: string, status: "failed" | "cancelled", error: string | null): Promise<void> {
  await db
    .prepare("UPDATE backups SET status = ?, error = ?, finished_at = utc_now() WHERE id = ?")
    .run(status, error, id);
}

export async function setBackupPinned(id: string, pinned: boolean): Promise<void> {
  await db.prepare("UPDATE backups SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
}

export async function deleteBackup(id: string): Promise<void> {
  await removeBackupFile(id);
  await db.prepare("DELETE FROM backups WHERE id = ?").run(id);
}

/** A connection that goes takes its backups with it: nothing would list them, and they hold its data. */
export async function deleteBackupsOfConnection(connectionId: string): Promise<number> {
  const ids = (await db.prepare("SELECT id FROM backups WHERE connection_id = ?").all(connectionId)) as {
    id: string;
  }[];
  for (const { id } of ids) await deleteBackup(id);
  await db.prepare("DELETE FROM backup_schedules WHERE connection_id = ?").run(connectionId);
  return ids.length;
}

/**
 * A backup still `running` when the server starts was cut short by the
 * restart: its file is partial and has no key. Said so, rather than left
 * spinning forever.
 */
export async function failInterruptedBackups(): Promise<number> {
  const ids = (await db.prepare("SELECT id FROM backups WHERE status = 'running'").all()) as { id: string }[];
  for (const { id } of ids) {
    await removeBackupFile(id);
    await markBackupEnded(id, "failed", "interrupted by a server restart");
  }
  return ids.length;
}

/** Keeps a connection's `keep` most recent scheduled backups; pinned ones neither count nor go. */
export async function pruneScheduledBackups(connectionId: string, keep: number): Promise<number> {
  const ids = (await db
    .prepare(
      `SELECT id FROM backups WHERE connection_id = ? AND trigger = 'scheduled' AND status = 'done' AND pinned = 0
        ORDER BY started_at DESC, seq DESC OFFSET ?`,
    )
    .all(connectionId, keep)) as { id: string }[];
  for (const { id } of ids) await deleteBackup(id);
  return ids.length;
}

/** Removes what is past the retention, pinned and scheduled backups excepted. `0` days keeps everything. */
export async function purgeExpiredBackups(): Promise<number> {
  if (config.databaseBackupRetentionDays <= 0) return 0;
  const ids = (await db
    .prepare(
      `SELECT id FROM backups WHERE pinned = 0 AND status != 'running' AND started_at < utc_now(?)
          AND NOT (trigger = 'scheduled' AND status = 'done')`,
    )
    .all(`-${config.databaseBackupRetentionDays} days`)) as { id: string }[];
  for (const { id } of ids) await deleteBackup(id);
  return ids.length;
}
