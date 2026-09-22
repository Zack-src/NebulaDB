import { time } from "@/utils/perfMonitor";

/**
 * Coalesces every "re-measure this node's handles" request raised in the same
 * tick into one batched call, instead of one call per table.
 *
 * `TableNode` asks the flow to re-measure a table's handle bounds whenever its
 * own field order changes — each table decides this for itself, independently.
 * The flow's own `updateNodeInternals` accepts a batch, but N separate
 * single-id calls (one per table) still cost N separate absolute-position
 * passes over *every* node — O(tables²) for anything that touches every
 * table's field order at once (the detail-level toggle chief among them). One
 * shared place collects what every table asked for and does the real work
 * exactly once.
 */

let pending = new Set<string>();
let flush: ((ids: string[]) => void) | null = null;
let scheduled = false;

function scheduleFlush(): void {
  if (scheduled) return;
  scheduled = true;
  // A microtask, not a raw synchronous call: every table whose field order
  // changed runs its effect in the same flush, so collecting for one tick
  // catches all of them before the batched call fires.
  queueMicrotask(() => {
    scheduled = false;
    const ids = Array.from(pending);
    pending = new Set();
    if (ids.length > 0) time("canvas.nodeInternalsFlush", () => flush?.(ids));
  });
}

/** Requests a re-measure of this node's handle bounds — batched with every other request raised in the same tick into one call. */
export function scheduleNodeInternalsUpdate(id: string): void {
  pending.add(id);
  scheduleFlush();
}

/**
 * Registers the real, store-bound flush this batches into. Installed once by
 * the canvas; returns the teardown.
 */
export function registerNodeInternalsFlush(next: (ids: string[]) => void): () => void {
  flush = next;
  return () => {
    if (flush === next) flush = null;
  };
}
