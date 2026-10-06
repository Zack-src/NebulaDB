/**
 * Lightweight perf instrumentation for the server's hot paths. A synchronous call that
 * blocks the event loop stalls every client's WebSocket, so `timeSync` keeps rolling stats
 * to spot it under load without a profiler. One `Date.now()` per call, no console output.
 */

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
}

/** Wraps a synchronous hot-path call, recording how long it took. */
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
