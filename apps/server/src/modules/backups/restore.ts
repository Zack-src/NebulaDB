import { q, type MigrationDialect } from "@athanordb/dbml-engine";
import {
  seedInsertOrder,
  type BackupCell,
  type BackupSummary,
  type DatabaseConnectionConfig,
  type Project,
  type RestoreResult,
  type RestoreTableResult,
  type Table,
} from "@athanordb/shared";
import { ApiError } from "../../shared/errors.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import type { DatabaseDriver } from "../connections/drivers/interface.js";
import { fromBackupCell } from "./format.js";
import { getBackupKey } from "./repository.js";
import { backupOrRefuse } from "./runner.js";
import { backupFileChecksum, readBackupLines } from "./storage.js";

const INSERT_BATCH = 500;

export interface RestoreRequest {
  /** Table names from the backup; omitted for all of them. */
  tables?: string[];
  /** The target connection's name, retyped. */
  confirmName?: string;
  /** Explicitly give up the copy of the target's current rows taken first. */
  skipSafetyBackup?: boolean;
  requestedBy: { id: string; displayName: string };
}

interface PlannedTable {
  /** As the backup names it. */
  name: string;
  columns: string[];
  live: Table;
}

function mismatch(reason: string, details: Record<string, unknown>): ApiError {
  return new ApiError("RESTORE_TARGET_MISMATCH", {
    message: `this backup cannot be restored there: ${reason}`,
    details,
  });
}

/**
 * Checks, before anything is touched, that every chosen table can go back:
 * it exists in the target with the columns the backup holds, no table left
 * out of the restore points at it (emptying it would fail on their foreign
 * keys — or cascade into them), and the chosen tables have an insertion order.
 */
function planRestore(backup: BackupSummary, live: Project, chosen: string[] | undefined): PlannedTable[] {
  const inBackup = new Map(backup.tables.map((table) => [table.name.toLowerCase(), table]));
  const names = chosen && chosen.length > 0 ? chosen : backup.tables.map((table) => table.name);
  const unknown = names.filter((name) => !inBackup.has(name.toLowerCase()));
  if (unknown.length > 0) throw new ApiError("BACKUP_INVALID", { details: { unknownTables: unknown } });

  const liveByName = new Map(live.tables.map((table) => [table.name.toLowerCase(), table]));
  const planned: PlannedTable[] = [];
  const missing: { table: string; columns?: string[] }[] = [];
  for (const key of new Set(names.map((name) => name.toLowerCase()))) {
    const stored = inBackup.get(key)!;
    const liveTable = liveByName.get(key);
    if (!liveTable) {
      missing.push({ table: stored.name });
      continue;
    }
    const liveColumns = new Set(liveTable.fields.map((field) => field.name.toLowerCase()));
    const absent = stored.columns.filter((column) => !liveColumns.has(column.toLowerCase()));
    if (absent.length > 0) missing.push({ table: stored.name, columns: absent });
    else planned.push({ name: stored.name, columns: stored.columns, live: liveTable });
  }
  if (missing.length > 0) {
    throw mismatch("tables or columns of the backup do not exist in the target — deploy the schema first", { missing });
  }

  const ids = new Set(planned.map((table) => table.live.id));
  const nameOf = new Map(live.tables.map((table) => [table.id, table.name]));
  const dependents = [
    ...new Set(
      live.refs
        .filter((ref) => ids.has(ref.to.tableId) && !ids.has(ref.from.tableId))
        .map((ref) => nameOf.get(ref.from.tableId) ?? ref.from.tableId),
    ),
  ];
  if (dependents.length > 0) {
    throw mismatch("other tables reference the ones being restored — restore them together", { dependents });
  }
  const { cycles } = seedInsertOrder([...ids], live.refs);
  if (cycles.length > 0) {
    throw mismatch("the tables depend on each other in a cycle", {
      cycles: cycles.map((cycle) => cycle.map((id) => nameOf.get(id) ?? id)),
    });
  }
  return planned;
}

/** Empties the planned tables, children first. Stops at the first table that refuses. */
async function emptyTables(
  driver: DatabaseDriver,
  planned: PlannedTable[],
  live: Project,
  dialect: MigrationDialect,
  results: Map<string, RestoreTableResult>,
): Promise<boolean> {
  const byId = new Map(planned.map((table) => [table.live.id, table]));
  const parentsFirst = seedInsertOrder([...byId.keys()], live.refs).order;
  for (const id of parentsFirst.reverse()) {
    const table = byId.get(id)!;
    const result = results.get(table.name)!;
    const target = q(table.live.name, dialect);
    try {
      result.deleted = (await driver.queryScalar(`SELECT COUNT(*) FROM ${target}`)) ?? 0;
      const outcome = await driver.executeMigration(`DELETE FROM ${target};`);
      if (!outcome.success) throw new Error(outcome.error ?? "delete failed");
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }
  return true;
}

/** Streams the backup back in, in the order it was written (parents first), a batch at a time. */
async function insertTables(
  driver: DatabaseDriver,
  backupId: string,
  keyEncrypted: string,
  planned: PlannedTable[],
  results: Map<string, RestoreTableResult>,
): Promise<void> {
  const byName = new Map(planned.map((table) => [table.name, table]));
  let current: PlannedTable | null = null;
  let batch: BackupCell[][] = [];
  const flush = async () => {
    if (!current || batch.length === 0) return;
    const rows = batch.map((row) => row.map(fromBackupCell));
    batch = [];
    results.get(current.name)!.inserted += await driver.insertRows(current.live.name, current.columns, rows);
  };
  try {
    for await (const line of readBackupLines(backupId, keyEncrypted)) {
      if (Array.isArray(line)) {
        if (!current) continue;
        batch.push(line as BackupCell[]);
        if (batch.length >= INSERT_BATCH) await flush();
        continue;
      }
      const marker = line as { table?: string; end?: string };
      if (typeof marker.table === "string") current = byName.get(marker.table) ?? null;
      else if (typeof marker.end === "string") {
        await flush();
        current = null;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Between tables, the failure is the file's own (unreadable, altered): nothing to attribute it to.
    if (!current) throw err;
    results.get(current.name)!.error = message;
  }
}

/**
 * Puts a backup's rows back into a database: the chosen tables are emptied
 * and refilled. Data only — the tables must already exist (structure goes
 * through a deployment). Everything that can be checked is checked before the
 * first row is removed, and the target's current rows are backed up first
 * unless the caller explicitly declined. It is not one transaction across
 * tables: a failure half-way is reported per table, and the safety backup is
 * what brings the previous state back.
 */
export async function restoreBackup(
  backup: BackupSummary,
  target: DatabaseConnectionConfig,
  request: RestoreRequest,
): Promise<RestoreResult> {
  const keyEncrypted = getBackupKey(backup.id);
  if (backup.status !== "done" || !keyEncrypted) throw new ApiError("BACKUP_NOT_READY");
  if (target.readOnly) throw new ApiError("CONNECTION_READ_ONLY");
  if (target.engine !== backup.engine) {
    throw mismatch(`it was taken from a ${backup.engine} database`, { engine: backup.engine });
  }
  if (typeof request.confirmName !== "string" || request.confirmName.trim() !== target.name.trim()) {
    throw new ApiError("RESTORE_CONFIRMATION_REQUIRED", { details: { connection: target.name } });
  }
  if ((await backupFileChecksum(backup.id)) !== backup.checksum) throw new ApiError("BACKUP_CORRUPTED");

  const driver = await createDatabaseDriver(target);
  let live: Project;
  let planned: PlannedTable[];
  try {
    live = await driver.introspectSchema();
    planned = planRestore(backup, live, request.tables);
  } catch (err) {
    await driver.close().catch(() => {});
    throw err;
  }

  try {
    const safety = request.skipSafetyBackup
      ? null
      : await backupOrRefuse({
          connection: target,
          trigger: "pre-restore",
          tables: planned.map((table) => table.live.name),
          note: `before restoring the backup of ${backup.startedAt}`,
          createdBy: request.requestedBy,
        });
    const results = new Map<string, RestoreTableResult>(
      planned.map((table) => [table.name, { name: table.name, deleted: null, inserted: 0 }]),
    );
    if (await emptyTables(driver, planned, live, target.engine as MigrationDialect, results)) {
      await insertTables(driver, backup.id, keyEncrypted, planned, results);
    }
    const tables = [...results.values()];
    return { success: tables.every((table) => !table.error), tables, safetyBackupId: safety?.id ?? null };
  } finally {
    await driver.close().catch(() => {});
  }
}
