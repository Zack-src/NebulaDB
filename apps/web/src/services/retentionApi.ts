import { request } from "./httpClient";

export type RetentionSource = "db" | "env" | "default";
export type RetentionUnit = "days" | "rows";

export interface RetentionPurgeState {
  at: string;
  deleted: number;
  cutoff: string | null;
  trigger: "scheduled" | "manual";
}

/** One journal of the retention policy, as `GET /api/admin/retention` lists it. */
export interface RetentionJournal {
  key: string;
  label: string;
  description: string;
  /** `days`: rows older than `value` days go; `rows`: the latest `value` rows are kept. */
  unit: RetentionUnit;
  /** In force now; `0` = kept forever. */
  value: number;
  source: RetentionSource;
  defaultValue: number;
  envVar: string | null;
  envValue: number | null;
  min: number;
  max: number;
  allowForever: boolean;
  /** Setting a value below this (and above 0) needs `confirm: true`. */
  confirmBelow: number | null;
  updatedBy: { id: string; email: string | null } | null;
  updatedAt: string | null;
  tables: string[];
  rows: number;
  bytes: number;
  oldest: string | null;
  lastPurge: RetentionPurgeState | null;
}

export interface RetentionPreview {
  key: string;
  unit: RetentionUnit;
  value: number;
  cutoff: string | null;
  rows: number;
}

export interface RetentionPurgeResult {
  key: string;
  unit: RetentionUnit;
  value: number;
  deleted: number;
  cutoff: string | null;
  batches: number;
  at: string;
}

const path = (key: string, suffix = "") => `/api/admin/retention/${encodeURIComponent(key)}${suffix}`;

export async function fetchRetention(): Promise<RetentionJournal[]> {
  return (await request<{ journals: RetentionJournal[] }>("/api/admin/retention")).journals;
}

/** What "purge now" would delete with the retention in force. */
export function fetchRetentionPreview(key: string): Promise<RetentionPreview> {
  return request<RetentionPreview>(path(key, "/preview"));
}

/** `value: null` goes back to the environment / default; `confirm` is required below the journal's `confirmBelow`. */
export async function setRetention(key: string, value: number | null, confirm?: boolean): Promise<RetentionJournal> {
  const body = confirm === undefined ? { value } : { value, confirm };
  return (await request<{ journal: RetentionJournal }>(path(key), { method: "PUT", body })).journal;
}

/** The journal's own key, typed back by the administrator, is the server's proof of intent. */
export function purgeRetention(key: string): Promise<RetentionPurgeResult> {
  return request<RetentionPurgeResult>(path(key, "/purge"), { method: "POST", body: { confirm: key } });
}
