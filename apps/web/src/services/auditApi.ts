import type { AuditEntry } from "@/types";
import { request } from "./httpClient";

export interface AuditQuery {
  limit?: number;
  before?: string;
  action?: string;
  targetId?: string;
}

export function fetchAuditLog(query: AuditQuery = {}): Promise<AuditEntry[]> {
  return request<AuditEntry[]>("/api/audit", { query: { ...query } });
}
