import { useState } from "react";
import type { CanvasNode } from "@/types/index";

/**
 * Mirrors `builtNodes` (the source of truth rebuilt from the doc) into local
 * React Flow node state, while keeping whatever `selected` a node already
 * had. `selected` is local UI state, not part of the doc — a fresh
 * `builtNodes` (any doc mutation, including e.g. a bulk color change applied
 * *from* the current selection) would otherwise wipe it, dropping the
 * selection and closing whatever UI depends on it (the multi-select color
 * toolbar) mid-use.
 *
 * Resetting during render (React's documented pattern for "adjust state when
 * an input changes") rather than in an effect avoids an extra render pass.
 */
export function useSelectionPreservingNodes(builtNodes: CanvasNode[]) {
  const [nodes, setNodes] = useState<CanvasNode[]>(builtNodes);
  const [prevBuiltNodes, setPrevBuiltNodes] = useState(builtNodes);
  if (builtNodes !== prevBuiltNodes) {
    setPrevBuiltNodes(builtNodes);
    setNodes((prevNodes) => {
      const selectedIds = new Set(prevNodes.filter((n) => n.selected).map((n) => n.id));
      return selectedIds.size === 0
        ? builtNodes
        : builtNodes.map((n) => (selectedIds.has(n.id) ? { ...n, selected: true } : n));
    });
  }
  return [nodes, setNodes] as const;
}
