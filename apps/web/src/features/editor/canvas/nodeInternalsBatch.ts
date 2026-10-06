import { time } from "@/utils/perfMonitor";

/**
 * Coalesces every "re-measure this node's handles" request raised in one tick into a single
 * batched call. Separate single-id `updateNodeInternals` calls each cost a pass over every node
 * (O(tables^2) when every table's field order changes at once, e.g. the detail-level toggle).
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
