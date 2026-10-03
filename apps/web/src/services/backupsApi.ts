import type { BackupList, BackupSummary, RestoreResult } from "@athanordb/shared";
import { request } from "./httpClient";

/** Backups of a connected database — instance administrators only, like the console they sit in. */

export function listBackups(connectionId: string): Promise<BackupList> {
  return request<BackupList>(`/api/admin/connections/${connectionId}/backups`);
}

/** Answers as soon as the backup has started; `listBackups` says how far it is. */
export async function startBackup(
  connectionId: string,
  options: { tables?: string[]; note?: string } = {},
): Promise<BackupSummary> {
  return (
    await request<{ backup: BackupSummary }>(`/api/admin/connections/${connectionId}/backups`, {
      method: "POST",
      body: options,
    })
  ).backup;
}

export async function cancelBackup(backupId: string): Promise<void> {
  await request(`/api/admin/backups/${backupId}/cancel`, { method: "POST" });
}

export async function setBackupPinned(backupId: string, pinned: boolean): Promise<void> {
  await request(`/api/admin/backups/${backupId}`, { method: "PATCH", body: { pinned } });
}

export async function deleteBackup(backupId: string): Promise<void> {
  await request(`/api/admin/backups/${backupId}`, { method: "DELETE" });
}

/** A plain link target: the browser downloads the decrypted, gzipped file with the session cookie. */
export function backupDownloadUrl(backupId: string): string {
  return `/api/admin/backups/${backupId}/download`;
}

export interface RestoreOptions {
  /** Where the rows go; the backup's own connection when omitted. */
  connectionId?: string;
  tables?: string[];
  /** The target connection's name, retyped — the server refuses without it. */
  confirmName: string;
  skipSafetyBackup?: boolean;
}

export async function restoreBackup(backupId: string, options: RestoreOptions): Promise<RestoreResult> {
  return (
    await request<{ result: RestoreResult }>(`/api/admin/backups/${backupId}/restore`, {
      method: "POST",
      body: options,
    })
  ).result;
}
