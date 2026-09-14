import { useState } from "react";
import type { CanvasNode } from "@/types/index";
import { time } from "@/utils/perfMonitor";

/**
 * merged node -> the `builtNodes` entry it was derived from.
 *
 * Without this, carrying `selected`/`measured` forward would hand React Flow
 * a brand-new object for every node on every rebuild, undoing the per-table
 * node cache (`tableNodeCache.ts`) one layer further up: React Flow's
 * `adoptUserNodes` skips a node entirely when the user object is reference-
 * identical to the one it already holds, so keeping identities stable for
 * untouched tables is the whole point.
 */
type DerivedFrom = WeakMap<CanvasNode, CanvasNode>;

/**
 * Mirrors `builtNodes` (the source of truth rebuilt from the doc) into local
 * React Flow node state, carrying two things across the rebuild that the doc
 * knows nothing about:
 *
 *  - **`selected`**, which is local UI state. A fresh `builtNodes` (any doc
 *    mutation, including a bulk colour change applied *from* the current
 *    selection) would otherwise wipe it, dropping the selection and closing
 *    whatever UI depends on it (the multi-select colour toolbar) mid-use.
 *
 *  - **`measured`**, React Flow's own measurement of the rendered node box.
 *    A node object rebuilt without it makes React Flow's `adoptUserNodes`
 *    treat the *whole canvas* as un-measured (`nodesInitialized = false`),
 *    which re-measures every node: `getBoundingClientRect` on every handle of
 *    every table — 16k forced layouts on a 500-table schema at full detail.
 *    Measured at ~690ms of style/layout for a single table's colour change,
 *    dwarfing every bit of JavaScript around it. Carrying the previous box
 *    forward keeps the canvas "initialized"; a node whose size really did
 *    change still gets corrected by React Flow's own ResizeObserver, for that
 *    one node instead of all of them.
 *
 * Resetting during render (React's documented pattern for "adjust state when
 * an input changes") rather than in an effect avoids an extra render pass.
 */
export function useSelectionPreservingNodes(builtNodes: CanvasNode[]) {
  const [nodes, setNodes] = useState<CanvasNode[]>(builtNodes);
  const [prevBuiltNodes, setPrevBuiltNodes] = useState(builtNodes);
  const [derivedFrom] = useState<DerivedFrom>(() => new WeakMap());

  function mergeNodes(prevNodes: CanvasNode[]) {
    const previousById = new Map(prevNodes.map((node) => [node.id, node]));
    return builtNodes.map((node) => {
      const previous = previousById.get(node.id);
      if (!previous) return node;

      const keepSelection = Boolean(previous.selected) && !node.selected;
      // A table node's box size is driven by its `detailLevel` (compact
      // renders 0 field rows, full renders every field — see
      // `TableNode.tsx`'s `rows` memo). Carrying the old `measured` box
      // forward across a detail-level change hands React Flow a box that's
      // now simply wrong, not just stale-until-corrected: going compact ->
      // full it's the smallest possible box standing in for the largest,
      // for every table at once when the change is a bulk one (the
      // detail-level toolbar buttons, `setAllDetailLevels`). Each of those
      // wrong boxes still gets corrected — but individually, via React
      // Flow's ResizeObserver, once per table; the resulting flood of
      // node-dimension-change events cascades into a full node/edge
      // rebuild after every single one of them. Not carrying `measured`
      // forward here instead lets every table whose size actually changed
      // re-measure together in the one settle-down pass React Flow already
      // does for a freshly-unmeasured node — the same path a first load
      // goes through, exercised at this size already.
      const sizeMayHaveChanged =
        node.type === "table" &&
        previous.type === "table" &&
        previous.data.table.detailLevel !== node.data.table.detailLevel;
      const keepMeasured = Boolean(previous.measured) && !node.measured && !sizeMayHaveChanged;
      if (!keepSelection && !keepMeasured) {
        derivedFrom.set(node, node);
        return node;
      }
      // Same source node, same selection: the object already in the store is
      // exactly what this rebuild would produce, so keep its identity.
      if (derivedFrom.get(previous) === node && Boolean(previous.selected) === keepSelection) return previous;

      const merged = {
        ...node,
        ...(keepSelection ? { selected: true } : {}),
        ...(keepMeasured ? { measured: previous.measured } : {}),
      } as CanvasNode;
      derivedFrom.set(merged, node);
      return merged;
    });
  }

  if (builtNodes !== prevBuiltNodes) {
    setPrevBuiltNodes(builtNodes);
    setNodes((prevNodes) => time("canvas.selectionPreservingMerge", () => mergeNodes(prevNodes)));
  }
  return [nodes, setNodes] as const;
}
