import type { AuditEntry } from "@/types";
import { request } from "./httpClient";

export type ActivityCategory =
  "structure" | "data" | "deployments" | "accounts" | "sessions" | "projects" | "configuration";

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "structure",
  "data",
  "deployments",
  "accounts",
  "sessions",
  "projects",
  "configuration",
];

export interface ActivityEntry extends AuditEntry {
  category: ActivityCategory;
  projectId: string | null;
  projectName: string | null;
  connectionId: string | null;
  connectionName: string | null;
  correlationId: string | null;
  actorName: string | null;
}

export interface ActivityFilters {
  /** `YYYY-MM-DD HH:MM:SS`, UTC. */
  from?: string;
  category?: ActivityCategory;
  projectId?: string;
  connectionId?: string;
  /** Only what this account did. */
  actorId?: string;
  search?: string;
}

/** Only the filters that are set — an empty value is no filter. */
function queryOf(filters: ActivityFilters): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Record<string, string>;
}

export function fetchActivity(
  filters: ActivityFilters,
  cursor?: number | null,
): Promise<{ entries: ActivityEntry[]; nextCursor: number | null }> {
  return request(`/api/admin/activity`, {
    query: { ...queryOf(filters), limit: "100", ...(cursor ? { cursor: String(cursor) } : {}) },
  });
}

/** Where the browser downloads everything the filters match. */
export function activityExportUrl(filters: ActivityFilters, format: "csv" | "json"): string {
  return `/api/admin/activity/export?${new URLSearchParams({ ...queryOf(filters), format }).toString()}`;
}
