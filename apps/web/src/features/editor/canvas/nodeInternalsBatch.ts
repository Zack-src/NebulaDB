import { useEffect } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { time } from "@/utils/perfMonitor";

/**
 * Coalesces every `updateNodeInternals(id)` request raised in the same tick
 * into one batched call, instead of one call per table.
 *
 * `TableNode` asks React Flow to re-measure a table's handle bounds whenever
 * its own field order changes (see the effect in `TableNode.tsx`) — each
 * table decides this for itself, independently. React Flow's own
 * `useUpdateNodeInternals()` *does* accept an array and batch internally, but
 * only within one call: N separate single-id calls (one per `TableNode`
 * instance) still cost N separate `updateAbsolutePositions` passes over
 * *every* node, each triggering its own store notification — O(tables) work,
 * paid once per table, i.e. O(tables²) for anything that touches every
 * table's field order at once (the detail-level toggle chief among them).
 * Same shape of bug as `highlightedFields.ts`'s O(tables × edges) one, same
 * fix: one shared place collects what every table asked for and does the
 * real work exactly once.
 */

let pending = new Set<string>();
let flush: ((ids: string[]) => void) | null = null;
let scheduled = false;

function scheduleFlush(): void {
  if (scheduled) return;
  scheduled = true;
  // A microtask, not a raw synchronous call: every `TableNode` whose field
  // order changed runs its effect in the same commit, so collecting for one
  // tick catches all of them before the batched call fires.
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
 * Registers the real, store-bound `updateNodeInternals` this batches into.
 * Mounted once, inside the `ReactFlowProvider` (see `CanvasArea`) — same
 * placement as `useHighlightedFieldsPublisher`.
 */
export function useNodeInternalsBatchPublisher(): void {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    flush = (ids) => updateNodeInternals(ids);
    return () => {
      flush = null;
    };
  }, [updateNodeInternals]);
}
