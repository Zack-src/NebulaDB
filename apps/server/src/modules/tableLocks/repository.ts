import type { TableLock, TableLockAuthority, TableLockLevel } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";

interface TableLockRow {
  project_id: string;
  table_id: string;
  table_name: string;
  level: TableLockLevel;
  authority: TableLockAuthority;
  reason: string | null;
  locked_by: string | null;
  locked_by_name: string | null;
  locked_at: string;
}

function toLock(row: TableLockRow): TableLock {
  return {
    projectId: row.project_id,
    tableId: row.table_id,
    tableName: row.table_name,
    level: row.level,
    authority: row.authority,
    reason: row.reason,
    lockedBy: row.locked_by,
    lockedByName: row.locked_by_name,
    lockedAt: row.locked_at,
  };
}

export async function listTableLocks(projectId: string): Promise<TableLock[]> {
  const rows = (await db
    .prepare("SELECT * FROM table_locks WHERE project_id = ? ORDER BY LOWER(table_name)")
    .all(projectId)) as TableLockRow[];
  return rows.map(toLock);
}

export async function getTableLock(projectId: string, tableId: string): Promise<TableLock | null> {
  const row = (await db
    .prepare("SELECT * FROM table_locks WHERE project_id = ? AND table_id = ?")
    .get(projectId, tableId)) as TableLockRow | undefined;
  return row ? toLock(row) : null;
}

export interface TableLockInput {
  projectId: string;
  tableId: string;
  tableName: string;
  level: TableLockLevel;
  authority: TableLockAuthority;
  reason: string | null;
  lockedBy: string;
  lockedByName: string;
}

/** Places a lock, or replaces the one already on this table — who locked it and when then describe the latest change. */
export async function upsertTableLock(input: TableLockInput): Promise<TableLock> {
  await db
    .prepare(
      `INSERT INTO table_locks (project_id, table_id, table_name, level, authority, reason, locked_by, locked_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, table_id) DO UPDATE SET
       table_name = excluded.table_name,
       level = excluded.level,
       authority = excluded.authority,
       reason = excluded.reason,
       locked_by = excluded.locked_by,
       locked_by_name = excluded.locked_by_name,
       locked_at = utc_now()`,
    )
    .run(
      input.projectId,
      input.tableId,
      input.tableName,
      input.level,
      input.authority,
      input.reason,
      input.lockedBy,
      input.lockedByName,
    );
  return (await getTableLock(input.projectId, input.tableId))!;
}

export async function deleteTableLock(projectId: string, tableId: string): Promise<boolean> {
  return (
    (await db.prepare("DELETE FROM table_locks WHERE project_id = ? AND table_id = ?").run(projectId, tableId))
      .changes > 0
  );
}

/** Cheap existence test for the realtime path: most projects have no lock at all. */
export async function projectHasTableLocks(projectId: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM table_locks WHERE project_id = ? LIMIT 1").get(projectId)) !== undefined;
}
