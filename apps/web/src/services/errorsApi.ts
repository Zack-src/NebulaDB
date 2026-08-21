import type { ErrorLogEntry } from "@/types";
import { request } from "./httpClient";

export interface ErrorLogQuery {
  limit?: number;
  before?: string;
  source?: "server" | "client";
}

export function fetchErrorLog(query: ErrorLogQuery = {}): Promise<ErrorLogEntry[]> {
  return request<ErrorLogEntry[]>("/api/errors", { query: { ...query } });
}

/**
 * Best-effort: called from `ErrorBoundary.componentDidCatch`, which is
 * already handling a crash — a failure to *report* the crash must never
 * throw again on top of it. Callers swallow the rejection themselves rather
 * than this function hiding it, so a caller with better context (retry,
 * a toast) isn't prevented from adding one later.
 */
export function reportClientError(report: { message: string; stack?: string; context?: string }): Promise<void> {
  return request<void>("/api/errors/client", { method: "POST", body: report });
}
