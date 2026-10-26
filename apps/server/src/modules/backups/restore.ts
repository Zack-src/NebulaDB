import { q, type MigrationDialect } from "@nebuladb/dbml-engine";
import {
  seedInsertOrder,
  type BackupCell,
  type BackupSummary,
  type DatabaseConnectionConfig,
  type Project,
  type RestoreResult,
  type RestoreTableResult,
  type Table,
} from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import type { DatabaseDriver, RestoreSession } from "../connections/drivers/interface.js";
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

/** What goes into a table's `INSERT`: the backup's columns minus the ones the target computes itself. */
interface InsertShape {
  columns: string[];
  /** Positions in a backup row of `columns`' values. */
  keep: number[];
  identity: string[];
}

/**
 * For a driver without a session of its own (BigQuery): each statement
 * stands on its own, through the driver's usual methods — the restore as it
 * always was, and said to be so (`atomic: false`).
 */
function statementSession(driver: DatabaseDriver, dialect: MigrationDialect): RestoreSession {
  return {
    atomic: false,
    identities: "unchanged",
    async describeTable() {
      return { generated: [], identity: [] };
    },
    async emptyTable(table) {
      const target = q(table, dialect);
      const count = (await driver.queryScalar(`SELECT COUNT(*) FROM ${target}`)) ?? 0;
      // BigQuery refuses a `DELETE` without a `WHERE`.
      const outcome = await driver.executeMigration(`DELETE FROM ${target} WHERE TRUE;`);
      if (!outcome.success) throw new Error(outcome.error ?? "delete failed");
      return count;
    },
    insertRows: (table, columns, rows) => driver.insertRows(table, columns, rows),
    async resyncIdentity() {},
    async commit() {},
    async rollback() {},
    async release() {},
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads each table's columns in the target: generated ones are left out of the inserts (and reported), identity ones noted. */
async function shapeTables(
  session: RestoreSession,
  planned: PlannedTable[],
  results: Map<string, RestoreTableResult>,
): Promise<Map<string, InsertShape> | null> {
  const shapes = new Map<string, InsertShape>();
  for (const table of planned) {
    const result = results.get(table.name)!;
    try {
      const { generated, identity } = await session.describeTable(table.live.name);
      const computed = new Set(generated.map((column) => column.toLowerCase()));
      const keep = table.columns.flatMap((column, i) => (computed.has(column.toLowerCase()) ? [] : [i]));
      const skipped = table.columns.filter((column) => computed.has(column.toLowerCase()));
      if (skipped.length > 0) result.skippedColumns = skipped;
      shapes.set(table.name, { columns: keep.map((i) => table.columns[i]), keep, identity });
    } catch (err) {
      result.error = messageOf(err);
      return null;
    }
  }
  return shapes;
}

/** Empties the planned tables, children first. Stops at the first table that refuses. */
async function emptyTables(
  session: RestoreSession,
  planned: PlannedTable[],
  live: Project,
  results: Map<string, RestoreTableResult>,
): Promise<boolean> {
  const byId = new Map(planned.map((table) => [table.live.id, table]));
  const parentsFirst = seedInsertOrder([...byId.keys()], live.refs).order;
  for (const id of parentsFirst.reverse()) {
    const table = byId.get(id)!;
    const result = results.get(table.name)!;
    try {
      result.deleted = await session.emptyTable(table.live.name);
    } catch (err) {
      result.error = messageOf(err);
      return false;
    }
  }
  return true;
}

/**
 * Streams the backup back in, in the order it was written (parents first), a
 * batch at a time. Returns whether every table went in; throws when the file
 * itself fails between tables (unreadable, altered): nothing to attribute it to.
 */
async function insertTables(
  session: RestoreSession,
  backupId: string,
  keyEncrypted: string,
  planned: PlannedTable[],
  shapes: Map<string, InsertShape>,
  results: Map<string, RestoreTableResult>,
): Promise<boolean> {
  const byName = new Map(planned.map((table) => [table.name, table]));
  let current: PlannedTable | null = null;
  let batch: BackupCell[][] = [];
  const flush = async () => {
    if (!current || batch.length === 0) return;
    const shape = shapes.get(current.name)!;
    const rows = batch.map((row) => shape.keep.map((i) => fromBackupCell(row[i])));
    batch = [];
    results.get(current.name)!.inserted += await session.insertRows(current.live.name, shape.columns, rows);
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
    return true;
  } catch (err) {
    if (!current) throw err;
    results.get(current.name)!.error = messageOf(err);
    return false;
  }
}

/** Moves each table's identity counters past the rows it now holds; says, per table, how they ended up. */
async function resyncIdentities(
  session: RestoreSession,
  planned: PlannedTable[],
  shapes: Map<string, InsertShape>,
  results: Map<string, RestoreTableResult>,
): Promise<boolean> {
  for (const table of planned) {
    const { identity } = shapes.get(table.name)!;
    if (identity.length === 0) continue;
    const result = results.get(table.name)!;
    try {
      await session.resyncIdentity(table.live.name, identity);
      result.identity = session.identities;
    } catch (err) {
      result.error = `the identity counter could not be moved past the restored rows: ${messageOf(err)}`;
      return false;
    }
  }
  return true;
}

/** Everything the restore does to the target, in order; stops at the first failure. Returns whether it all went through. */
async function restoreInto(
  session: RestoreSession,
  backupId: string,
  keyEncrypted: string,
  planned: PlannedTable[],
  live: Project,
  results: Map<string, RestoreTableResult>,
): Promise<boolean> {
  const shapes = await shapeTables(session, planned, results);
  return (
    shapes !== null &&
    (await emptyTables(session, planned, live, results)) &&
    (await insertTables(session, backupId, keyEncrypted, planned, shapes, results)) &&
    (await resyncIdentities(session, planned, shapes, results))
  );
}

/**
 * Puts a backup's rows back into a database: the chosen tables are emptied
 * and refilled. Data only — the tables must already exist (structure goes
 * through a deployment). Everything that can be checked is checked before the
 * first row is removed, and the target's current rows are backed up first
 * unless the caller explicitly declined.
 *
 * Where the driver can (`RestoreSession.atomic`: PostgreSQL, SQLite, SQL
 * Server, Oracle, MySQL when every table is InnoDB), the whole restore is one
 * transaction: a failure anywhere rolls it all back and the target is left as
 * it was (`rolledBack`). Elsewhere a failure half-way is reported per table,
 * and the safety backup is what brings the previous state back.
 *
 * Rows keep their ids: identity columns take the backup's values (PostgreSQL
 * `OVERRIDING SYSTEM VALUE`, SQL Server `IDENTITY_INSERT`, MySQL
 * `NO_AUTO_VALUE_ON_ZERO`), columns the target computes itself are left out,
 * and identity counters are moved past the restored rows where the engine
 * does not do it on its own — each table's result says which.
 */
export async function restoreBackup(
  backup: BackupSummary,
  target: DatabaseConnectionConfig,
  request: RestoreRequest,
): Promise<RestoreResult> {
  const keyEncrypted = await getBackupKey(backup.id);
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
    const session = driver.openRestoreSession
      ? await driver.openRestoreSession(planned.map((table) => table.live.name))
      : statementSession(driver, target.engine as MigrationDialect);
    let succeeded: boolean;
    try {
      succeeded = await restoreInto(session, backup.id, keyEncrypted, planned, live, results);
      if (succeeded) {
        try {
          await session.commit();
        } catch (err) {
          succeeded = false;
          for (const result of results.values()) {
            result.error ??= `the restore could not be committed: ${messageOf(err)}`;
          }
        }
      }
      if (!succeeded) await session.rollback();
    } catch (err) {
      await session.rollback();
      throw err;
    } finally {
      await session.release();
    }

    const rolledBack = !succeeded && session.atomic;
    if (rolledBack) {
      // Nothing of it is left: the counts say so, the error says where it stopped.
      for (const result of results.values()) {
        result.deleted = null;
        result.inserted = 0;
        delete result.identity;
      }
    }
    const tables = [...results.values()];
    return {
      success: succeeded,
      tables,
      safetyBackupId: safety?.id ?? null,
      atomic: session.atomic,
      rolledBack,
    };
  } finally {
    await driver.close().catch(() => {});
  }
}
