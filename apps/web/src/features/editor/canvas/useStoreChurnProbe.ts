import { useEffect } from "react";
import { useStore } from "@xyflow/react";
import { recordDuration } from "@/utils/perfMonitor";

/**
 * Diagnostic-only: counts how often React Flow hands out a *new* `nodes`/
 * `edges` array reference from its internal store. Exists to test one
 * specific hypothesis about the pan/zoom freeze at high table counts —
 * `onlyRenderVisibleElements` (set on `<ReactFlow>` in this file) recomputes
 * which nodes/edges are "visible" on every viewport change, which means a
 * fresh array reference on every pan/zoom tick, which in turn re-runs every
 * node's own `useStore` selectors (see `TableNode`'s `linkedFieldKey`) even
 * when nothing about the diagram itself changed.
 *
 * Records a zero-duration sample per label — not timing anything, just using
 * `recordDuration`'s `count` as a frequency counter, visible in the PerfHud
 * as e.g. "store.edgesIdentityChanged: n=47" after a pan gesture. A high
 * count that tracks 1:1 with pan/zoom frames (not with actual edits)
 * confirms the hypothesis; a flat count rules it out.
 */
export function useStoreChurnProbe(): void {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);

  useEffect(() => {
    recordDuration("store.nodesIdentityChanged", 0);
  }, [nodes]);

  useEffect(() => {
    recordDuration("store.edgesIdentityChanged", 0);
  }, [edges]);
}
