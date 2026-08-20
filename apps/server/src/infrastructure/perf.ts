/**
 * Lightweight, dependency-free perf instrumentation for the server's hot
 * paths — same intent as `apps/web/src/utils/perfMonitor.ts` on the client
 * side, sized for a Node process instead of a browser tab.
 *
 * Node is single-threaded: a synchronous call that blocks the event loop
 * (a `better-sqlite3` write, JSON-heavy work) doesn't just slow the request
 * that triggered it — it stalls *every* connected client's WebSocket frame
 * until it returns. `timeSync` exists specifically to catch that: it logs
 * any call past `LOG_THRESHOLD_MS` and keeps rolling stats so a slow spot
 * that only shows up under real load (many tables, many collaborators) is
 * visible without attaching a profiler.
 *
 * Off by default (near-zero overhead: one `Date.now()` per call, no
 * console output) — set `ATHANORDB_PERF_LOG=1` to log slow calls as they
 * happen. Stats always accumulate regardless, cheaply, so `getPerfReport()`
 * (wired into the health-check-adjacent `/api/_debug/perf` route in dev) is
 * useful even without the env var.
 */

const LOG_THRESHOLD_MS = 20;
const logEnabled = process.env.ATHANORDB_PERF_LOG === "1";

interface Stat {
  count: number;
  totalMs: number;
  maxMs: number;
}

const stats = new Map<string, Stat>();

function record(label: string, durationMs: number): void {
  let stat = stats.get(label);
  if (!stat) {
    stat = { count: 0, totalMs: 0, maxMs: 0 };
    stats.set(label, stat);
  }
  stat.count++;
  stat.totalMs += durationMs;
  stat.maxMs = Math.max(stat.maxMs, durationMs);

  if (logEnabled && durationMs > LOG_THRESHOLD_MS) {
    console.warn(`[perf] ${label} took ${durationMs.toFixed(1)}ms (blocked the event loop)`);
  }
}

/** Wraps a synchronous hot-path call, recording how long it took (and, past the threshold with `ATHANORDB_PERF_LOG=1`, logging it). */
export function timeSync<T>(label: string, fn: () => T): T {
  const start = Date.now();
  try {
    return fn();
  } finally {
    record(label, Date.now() - start);
  }
}

export interface PerfReportRow {
  label: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export function getPerfReport(): PerfReportRow[] {
  return Array.from(stats.entries())
    .map(([label, s]) => ({
      label,
      count: s.count,
      totalMs: Math.round(s.totalMs),
      avgMs: Math.round((s.totalMs / s.count) * 10) / 10,
      maxMs: s.maxMs,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function resetPerfReport(): void {
  stats.clear();
}
