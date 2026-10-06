import type {
  BackupFileHeader,
  BackupSummary,
  BackupTableInfo,
  BackupTrigger,
  DatabaseConnectionConfig,
} from "@nebuladb/shared";
import { config } from "../../config.js";
import { ApiError } from "../../shared/errors.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import { backupPageSql, tablesInBackupOrder, toBackupCell } from "./format.js";
import {
  getBackup,
  hasRunningBackup,
  insertBackup,
  markBackupDone,
  markBackupEnded,
  recordProgress,
} from "./repository.js";
import { openBackupWriter, type BackupWriter } from "./storage.js";

/** Rows read per query: small enough to hold in memory whatever the table, large enough not to crawl. */
const PAGE_ROWS = 2000;

class BackupCancelled extends Error {}

/** Backups running in this process, by id — what a cancel request reaches. */
const running = new Map<string, { cancelled: boolean }>();

export function cancelBackup(id: string): boolean {
  const job = running.get(id);
  if (job) job.cancelled = true;
  return job !== undefined;
}

export interface BackupRequest {
  connection: DatabaseConnectionConfig;
  trigger: BackupTrigger;
  /** Table names; omitted or `null` for the whole database. */
  tables?: string[] | null;
  note?: string | null;
  createdBy?: { id: string; displayName: string } | null;
}

/** Lets pending requests (a cancel, a progress poll) through between pages — SQLite reads are synchronous. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function run(id: string, request: BackupRequest, job: { cancelled: boolean }): Promise<void> {
  const { connection } = request;
  let writer: BackupWriter | null = null;
  const driver = await createDatabaseDriver(connection);
  try {
    const tables = tablesInBackupOrder(await driver.introspectSchema(), request.tables ?? null);
    const done: BackupTableInfo[] = [];
    let rows = 0;
    recordProgress(id, tables.length, done, rows);

    writer = openBackupWriter(id);
    const header: BackupFileHeader = {
      format: "nebuladb-backup",
      version: 1,
      engine: connection.engine,
      connectionName: connection.name,
      createdAt: new Date().toISOString(),
      tables: tables.map((table) => table.name),
    };
    await writer.write(header);

    for (const table of tables) {
      const columns = table.fields.map((field) => field.name);
      const primaryKey = table.fields.filter((field) => field.pk).map((field) => field.name);
      await writer.write({ table: table.name, columns });
      let count = 0;
      for (let offset = 0; ; offset += PAGE_ROWS) {
        if (job.cancelled) throw new BackupCancelled();
        const page = await driver.queryRows(
          backupPageSql(connection.engine, table.name, columns, primaryKey, PAGE_ROWS, offset),
        );
        for (const row of page) await writer.write(row.map(toBackupCell));
        count += page.length;
        if (writer.bytes > config.databaseBackupMaxBytes) {
          throw new Error(
            `the database holds more than the ${Math.round(config.databaseBackupMaxBytes / (1024 * 1024))} MB a logical ` +
              "backup may read (NEBULADB_DATABASE_BACKUP_MAX_MB) — back up fewer tables, or use the engine's own tool",
          );
        }
        if (page.length < PAGE_ROWS) break;
        await breathe();
      }
      await writer.write({ end: table.name, rows: count });
      rows += count;
      done.push({ name: table.name, columns, rows: count });
      recordProgress(id, tables.length, done, rows);
      await breathe();
    }
    markBackupDone(id, await writer.finish());
  } catch (err) {
    await writer?.abort();
    if (err instanceof BackupCancelled) markBackupEnded(id, "cancelled", null);
    else markBackupEnded(id, "failed", err instanceof Error ? err.message : String(err));
  } finally {
    await driver.close().catch(() => {});
  }
}

/**
 * Starts a backup and returns at once with its record; `done` settles when it
 * has finished one way or another and never rejects — the outcome is the
 * record's `status`. One backup per database at a time: two would read the
 * same tables twice over for no gain.
 */
export function startBackup(request: BackupRequest): { backup: BackupSummary; done: Promise<BackupSummary> } {
  const { connection } = request;
  if (hasRunningBackup(connection.id)) throw new ApiError("BACKUP_ALREADY_RUNNING");
  const id = insertBackup({
    connectionId: connection.id,
    connectionName: connection.name,
    engine: connection.engine,
    trigger: request.trigger,
    scope: request.tables && request.tables.length > 0 ? request.tables : null,
    note: request.note ?? null,
    createdBy: request.createdBy ?? null,
  });
  const job = { cancelled: false };
  running.set(id, job);
  const done = run(id, request, job)
    // Only what `run` could not handle itself: the driver failing to open.
    .catch((err: unknown) => markBackupEnded(id, "failed", err instanceof Error ? err.message : String(err)))
    .then(() => {
      running.delete(id);
      return getBackup(id)!;
    });
  return { backup: getBackup(id)!, done };
}

/**
 * A backup someone is waiting on before writing to the database (a
 * deployment, a restore): resolves with the finished backup, or refuses with
 * `BACKUP_FAILED` and the reason.
 */
export async function backupOrRefuse(request: BackupRequest): Promise<BackupSummary> {
  const backup = await startBackup(request).done;
  if (backup.status !== "done") {
    throw new ApiError("BACKUP_FAILED", {
      message: `the safety backup did not complete: ${backup.error ?? backup.status}`,
      details: { backupId: backup.id, reason: backup.error ?? backup.status },
    });
  }
  return backup;
}
