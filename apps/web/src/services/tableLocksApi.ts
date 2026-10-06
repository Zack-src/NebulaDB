import type { TableLock, TableLockAuthority, TableLockLevel, TableLocksResponse } from "@nebuladb/shared";
import { request } from "./httpClient";

const base = (projectId: string) => `/api/projects/${projectId}/locks`;

export function fetchTableLocks(projectId: string): Promise<TableLocksResponse> {
  return request<TableLocksResponse>(base(projectId));
}

/** Places a lock, or replaces the one already on the table. */
export function lockTable(
  projectId: string,
  tableId: string,
  input: { level: TableLockLevel; authority: TableLockAuthority; reason: string | null },
): Promise<TableLock> {
  return request<TableLock>(`${base(projectId)}/${encodeURIComponent(tableId)}`, { method: "PUT", body: input });
}

export function unlockTable(projectId: string, tableId: string): Promise<void> {
  return request<void>(`${base(projectId)}/${encodeURIComponent(tableId)}`, { method: "DELETE" });
}
