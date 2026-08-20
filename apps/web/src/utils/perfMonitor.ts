/**
 * Lightweight, dependency-free perf instrumentation for hunting editor
 * stutter/freezes. Disabled by default in production so it costs nothing for
 * real users; flip it on with `localStorage.setItem("athanor:perf", "1")` and
 * reload (works in a prod build too, so a reported freeze can be reproduced
 * and measured without a dev rebuild). Always on in `import.meta.env.DEV`.
 *
 * Three pieces:
 *  - `time`/`timeAsync` wrap a hot function, recording how long it took.
 *  - a `longtask` PerformanceObserver flags any >50ms main-thread block even
 *    if it isn't inside one of the wrapped spots above (React itself, a
 *    third-party lib, GC, layout thrashing...).
 *  - `logPerfReport()` (also reachable as `window.__athanorPerf.report()`
 *    from devtools) prints a table of every measured label, worst offenders
 *    first.
 */

export const PERF_LOG_THRESHOLD_MS = 16; // one dropped frame at 60fps

function readEnabledFlag(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("athanor:perf") === "1";
  } catch {
    return false;
  }
}

let enabled = readEnabledFlag();
/**
 * Records spans but says nothing. The perf harness (`features/editor/bench`)
 * needs every `time()` span in a production build, and a `console.warn` per
 * span past 16ms would be thousands of console round-trips inside the very
 * window being measured — enough to change the number it is measuring.
 */
let quiet = false;

export function setPerfQuiet(next: boolean): void {
  quiet = next;
}

interface Stat {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  /** Ring buffer of the most recent samples, for a rough p95 without keeping every sample forever. */
  samples: number[];
}

const SAMPLE_CAP = 200;
const stats = new Map<string, Stat>();

function record(label: string, durationMs: number): void {
  let stat = stats.get(label);
  if (!stat) {
    stat = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0, samples: [] };
    stats.set(label, stat);
  }
  stat.count++;
  stat.totalMs += durationMs;
  stat.maxMs = Math.max(stat.maxMs, durationMs);
  stat.lastMs = durationMs;
  stat.samples.push(durationMs);
  if (stat.samples.length > SAMPLE_CAP) stat.samples.shift();

  if (enabled && !quiet && durationMs > PERF_LOG_THRESHOLD_MS) {
    console.warn(`[perf] ${label} took ${durationMs.toFixed(1)}ms`);
  }
}

/** Wraps a synchronous hot-path function, recording (and, past the threshold, logging) how long it took. No-ops to a bare call when perf logging is off, so this is safe to leave in place permanently. */
export function time<T>(label: string, fn: () => T): T {
  if (!enabled) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - start);
  }
}

/** Same as `time`, for an async hot path — measures wall time including any awaited work. */
export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - start);
  }
}

/** Records a duration measured elsewhere (e.g. a React Profiler `onRender` callback), rather than timing a call this module makes itself. */
export function recordDuration(label: string, durationMs: number): void {
  if (!enabled) return;
  record(label, durationMs);
}

export interface PerfReportRow {
  label: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
  lastMs: number;
}

export function getPerfReport(): PerfReportRow[] {
  return Array.from(stats.entries())
    .map(([label, s]) => {
      const sorted = [...s.samples].sort((a, b) => a - b);
      const p95 = sorted.length > 0 ? sorted[Math.floor(0.95 * (sorted.length - 1))] : 0;
      return {
        label,
        count: s.count,
        totalMs: Math.round(s.totalMs),
        avgMs: Math.round((s.totalMs / s.count) * 10) / 10,
        maxMs: Math.round(s.maxMs * 10) / 10,
        p95Ms: Math.round(p95 * 10) / 10,
        lastMs: Math.round(s.lastMs * 10) / 10,
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function logPerfReport(): void {
  console.table(getPerfReport());
}

export function resetPerfReport(): void {
  stats.clear();
}

export function isPerfEnabled(): boolean {
  return enabled;
}

export function setPerfEnabled(next: boolean): void {
  enabled = next;
  try {
    if (next) localStorage.setItem("athanor:perf", "1");
    else localStorage.removeItem("athanor:perf");
  } catch {
    // localStorage unavailable (private mode, etc.) — in-memory flag still works for this session.
  }
}

// Long tasks (any >50ms main-thread block, whether or not it's inside a
// `time()` span) are the direct browser-native signal for "the UI just
// froze". Not every browser exposes this entry type, so failure is silent.
if (typeof PerformanceObserver !== "undefined") {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        record("longtask", entry.duration);
        if (enabled && !quiet) {
          console.warn(`[perf] long task blocked the main thread for ${entry.duration.toFixed(1)}ms`, entry);
        }
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // 'longtask' entry type not supported in this browser — the wrapped `time()` spans still work.
  }
}

declare global {
  interface Window {
    __athanorPerf?: {
      report: () => void;
      stats: () => PerfReportRow[];
      reset: () => void;
      enable: () => void;
      disable: () => void;
    };
  }
}

if (typeof window !== "undefined") {
  window.__athanorPerf = {
    report: logPerfReport,
    stats: getPerfReport,
    reset: resetPerfReport,
    enable: () => setPerfEnabled(true),
    disable: () => setPerfEnabled(false),
  };
}
