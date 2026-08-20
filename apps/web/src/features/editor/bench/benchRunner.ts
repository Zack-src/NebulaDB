import * as Y from "yjs";
import { getRefsMap, getTablesMap, type Field } from "@athanordb/shared";
import { getPerfReport, resetPerfReport, setPerfEnabled, setPerfQuiet, type PerfReportRow } from "@/utils/perfMonitor";
import type { BenchConfig } from "./benchProject";

/**
 * In-page half of the canvas perf harness.
 *
 * The driver (`scripts/bench-web.mjs`) owns everything a real user does with
 * a mouse — wheel zoom, node drags, toolbar clicks — because only real
 * (CDP-level) input goes through React Flow's own d3-zoom/d3-drag handlers.
 * What lives here is the part a driver can't do from outside the page:
 *
 *  - frame/long-task sampling around a measured window;
 *  - the schema mutations whose UI path is a popover click but whose *cost*
 *    is entirely in the doc-update pipeline that follows (recolour, column
 *    flags, column deletion). Each one performs byte-for-byte the same Yjs
 *    write the corresponding handler in `buildTableNodes`/`useProjectMutations`
 *    performs, so the measured work downstream is the real thing.
 */

export interface BenchFrameStats {
  count: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Frames longer than ~2 refresh intervals — what a user perceives as a stutter. */
  droppedFrames: number;
  fps: number;
}

export interface BenchMetrics {
  label: string;
  durationMs: number;
  frames: BenchFrameStats;
  longTasks: { count: number; totalMs: number; maxMs: number };
  /** Main-thread time spent in tasks over 50ms — the standard "blocking time" proxy for a freeze. */
  totalBlockingMs: number;
  perf: PerfReportRow[];
}

const FRAME_BUDGET_MS = 1000 / 60;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

class BenchSession {
  private frameTimes: number[] = [];
  private longTasks: number[] = [];
  private rafHandle: number | null = null;
  private observer: PerformanceObserver | null = null;
  private startedAt = 0;
  private lastFrameAt = 0;

  constructor(private readonly label: string) {}

  start(): void {
    resetPerfReport();
    this.startedAt = performance.now();
    this.lastFrameAt = this.startedAt;
    if (typeof PerformanceObserver !== "undefined") {
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) this.longTasks.push(entry.duration);
        });
        this.observer.observe({ type: "longtask", buffered: false });
      } catch {
        this.observer = null;
      }
    }
    const tick = (now: number) => {
      this.frameTimes.push(now - this.lastFrameAt);
      this.lastFrameAt = now;
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): BenchMetrics {
    const durationMs = performance.now() - this.startedAt;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.observer?.disconnect();
    // The first sample spans "start() -> first frame", which includes
    // whatever was already queued before the window opened.
    const samples = this.frameTimes.slice(1);
    const sorted = [...samples].sort((a, b) => a - b);
    const total = samples.reduce((sum, value) => sum + value, 0);
    return {
      label: this.label,
      durationMs: round(durationMs),
      frames: {
        count: samples.length,
        avgMs: round(samples.length ? total / samples.length : 0),
        p95Ms: round(percentile(sorted, 0.95)),
        maxMs: round(Math.max(0, ...samples)),
        droppedFrames: samples.filter((ms) => ms > FRAME_BUDGET_MS * 2).length,
        fps: round(total > 0 ? (samples.length / total) * 1000 : 0),
      },
      longTasks: {
        count: this.longTasks.length,
        totalMs: round(this.longTasks.reduce((sum, value) => sum + value, 0)),
        maxMs: round(Math.max(0, ...this.longTasks)),
      },
      totalBlockingMs: round(this.longTasks.reduce((sum, value) => sum + Math.max(0, value - 50), 0)),
      perf: getPerfReport().filter((row) => row.totalMs >= 1),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface BenchApi {
  config: BenchConfig;
  start(label: string): void;
  stop(): BenchMetrics;
  /** Resolves once the canvas has painted `expected` table nodes (or the timeout lapses). */
  ready(expected: number, timeoutMs?: number): Promise<{ nodes: number; edges: number; waitedMs: number }>;
  /** Resolves after `frames` animation frames — used to close a measurement window on a real paint. */
  frames(count: number): Promise<void>;
  counts(): { nodes: number; edges: number };
  setTablesColor(tableIndexes: number[], color: string): void;
  toggleFieldFlag(tableIndex: number, fieldIndex: number, flag: "pk" | "unique" | "notNull"): void;
  deleteColumns(tableIndex: number, count: number): void;
}

declare global {
  interface Window {
    __athanorBench?: BenchApi;
  }
}

/** Same write `buildTableNodes`' `onUpdateField` performs, minus the popover. */
function updateField(doc: Y.Doc, tableId: string, fieldId: string, patch: Partial<Field>): void {
  const tables = getTablesMap(doc);
  const current = tables.get(tableId);
  if (!current) return;
  tables.set(tableId, {
    ...current,
    fields: current.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
  });
}

export function installBenchRunner(doc: Y.Doc, config: BenchConfig): void {
  // Records every `time()` span in a production build too, without the
  // per-span console.warn that would itself distort the measurement.
  setPerfEnabled(true);
  setPerfQuiet(true);

  let session: BenchSession | null = null;

  const counts = () => ({
    nodes: document.querySelectorAll(".react-flow__node").length,
    edges: document.querySelectorAll(".react-flow__edge").length,
  });

  window.__athanorBench = {
    config,
    start(label) {
      session = new BenchSession(label);
      session.start();
    },
    stop() {
      if (!session) throw new Error("bench: stop() without start()");
      const metrics = session.stop();
      session = null;
      return metrics;
    },
    async ready(expected, timeoutMs = 120_000) {
      const startedAt = performance.now();
      for (;;) {
        const current = counts();
        if (current.nodes >= expected || performance.now() - startedAt > timeoutMs) {
          return { ...current, waitedMs: round(performance.now() - startedAt) };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    frames(count) {
      return new Promise((resolve) => {
        let remaining = count;
        const tick = () => (remaining-- <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
    },
    counts,
    setTablesColor(tableIndexes, color) {
      const tables = getTablesMap(doc);
      doc.transact(() => {
        for (const index of tableIndexes) {
          const current = tables.get(`t${index}`);
          if (current) tables.set(`t${index}`, { ...current, style: { ...current.style, color } });
        }
      });
    },
    toggleFieldFlag(tableIndex, fieldIndex, flag) {
      const tableId = `t${tableIndex}`;
      const current = getTablesMap(doc).get(tableId);
      const field = current?.fields[fieldIndex];
      if (!field) return;
      updateField(doc, tableId, field.id, { [flag]: !field[flag] });
    },
    deleteColumns(tableIndex, count) {
      const tableId = `t${tableIndex}`;
      const tables = getTablesMap(doc);
      const refs = getRefsMap(doc);
      for (let i = 0; i < count; i++) {
        const current = tables.get(tableId);
        if (!current || current.fields.length === 0) return;
        // Last column first: never the PK/FK the generated refs hang off, so
        // repeated runs stay comparable.
        const victim = current.fields[current.fields.length - 1];
        doc.transact(() => {
          for (const [refId, ref] of refs.entries()) {
            if (
              (ref.from.tableId === tableId && ref.from.fieldId === victim.id) ||
              (ref.to.tableId === tableId && ref.to.fieldId === victim.id)
            ) {
              refs.delete(refId);
            }
          }
          tables.set(tableId, { ...current, fields: current.fields.filter((f) => f.id !== victim.id) });
        });
      }
    },
  };
}
