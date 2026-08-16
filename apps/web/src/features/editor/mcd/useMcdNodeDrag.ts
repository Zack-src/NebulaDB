import { useCallback, useEffect, useRef, useState } from "react";
import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import { isTypingTarget } from "@/utils/dom";
import type { McdNode } from "./mcdNodes";

/** Keeps each still-present node wherever it currently sits on screen, taking everything else (data, new/removed nodes) from the freshly derived set. */
function preserveDraggedPositions(current: McdNode[], next: McdNode[]): McdNode[] {
  const currentById = new Map(current.map((n) => [n.id, n]));
  return next.map((base) => {
    const existing = currentById.get(base.id);
    return existing ? { ...base, position: existing.position } : base;
  });
}

/**
 * Local drag state for the MCD canvas: node positions, a small undo/redo
 * stack for that dragging, and the Ctrl+Z/Y binding that drives it.
 * Deliberately separate from the app's Yjs `undoManager` — nothing dragged
 * here is ever written to the project, so routing Ctrl+Z through the real
 * history would either no-op confusingly or undo an unrelated MLD edit.
 * `ProjectEditor` disables that global shortcut while this view is mounted;
 * this hook is what Ctrl+Z/Y control instead.
 */
export function useMcdNodeDrag(baseNodes: McdNode[]) {
  // Held in local state (not derived directly) so a drag sticks for the rest
  // of the session — re-running `deriveMCD` on every unrelated project edit
  // would otherwise snap every node straight back to its base position. Only
  // nodes that actually appeared or disappeared get reconciled; anything
  // still around keeps wherever it currently is on screen.
  //
  // Reconciled *during render* rather than in an effect: an effect would let
  // React paint one frame of the stale node set first, then immediately
  // re-render with the reconciled one — the cascading render the
  // `set-state-in-effect` rule exists to catch. Setting state during render
  // of the same component is the documented way to adjust state when a prop
  // changes (react.dev, "You Might Not Need an Effect"): React discards this
  // render and re-runs the component before touching the DOM at all.
  const [nodes, setNodes] = useState<McdNode[]>(baseNodes);
  const [reconciledFrom, setReconciledFrom] = useState(baseNodes);
  if (reconciledFrom !== baseNodes) {
    setReconciledFrom(baseNodes);
    setNodes((current) => preserveDraggedPositions(current, baseNodes));
  }

  const historyRef = useRef<McdNode[][]>([]);
  const futureRef = useRef<McdNode[][]>([]);
  const dragSnapshotRef = useRef<McdNode[] | null>(null);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const dragStarting = changes.some((c) => c.type === "position" && c.dragging === true);
      if (dragStarting && dragSnapshotRef.current === null) dragSnapshotRef.current = current;
      const next = applyNodeChanges(changes, current) as McdNode[];
      const dragEnded = changes.some((c) => c.type === "position" && c.dragging === false);
      if (dragEnded && dragSnapshotRef.current) {
        historyRef.current.push(dragSnapshotRef.current);
        futureRef.current = [];
        dragSnapshotRef.current = null;
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setNodes((current) => {
      const prev = historyRef.current.pop();
      if (!prev) return current;
      futureRef.current.push(current);
      return prev;
    });
  }, []);
  const redo = useCallback(() => {
    setNodes((current) => {
      const next = futureRef.current.pop();
      if (!next) return current;
      historyRef.current.push(current);
      return next;
    });
  }, []);
  const resetPositions = useCallback(() => {
    historyRef.current = [];
    futureRef.current = [];
    setNodes(baseNodes);
  }, [baseNodes]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return { nodes, onNodesChange, resetPositions };
}
