import { untrack } from "svelte";
import { isTypingTarget } from "@/utils/dom";
import type { McdNode } from "./mcdNodes";

/** Keeps each still-present node wherever it currently sits on screen, taking everything else (data, new/removed nodes) from the freshly derived set. */
function preserveDraggedPositions(current: McdNode[], next: McdNode[]): McdNode[] {
  const currentById = new Map(current.map((n) => [n.id, n]));
  return next.map((base) => {
    const existing = currentById.get(base.id);
    return existing ? ({ ...base, position: existing.position } as McdNode) : base;
  });
}

/**
 * Local drag state for the MCD canvas: node positions (bound two-way to the
 * flow), a small undo/redo stack for that dragging, and the Ctrl+Z/Y binding
 * that drives it. Deliberately separate from the app's Yjs undo manager —
 * nothing dragged here is ever written to the project, so routing Ctrl+Z
 * through the real history would either no-op confusingly or undo an
 * unrelated MLD edit. `ProjectEditor` disables that global shortcut while this
 * view is mounted; this is what Ctrl+Z/Y control instead.
 *
 * Must be called during component initialisation.
 */
export function useMcdNodeDrag(baseNodes: () => McdNode[]) {
  // Held in local state (not derived directly) so a drag sticks for the rest
  // of the session — re-deriving the model on every unrelated project edit
  // would otherwise snap every node straight back to its base position. Only
  // nodes that actually appeared or disappeared get reconciled; anything
  // still around keeps wherever it currently is on screen.
  let nodes = $state.raw<McdNode[]>(untrack(baseNodes));
  let reconciledFrom = untrack(baseNodes);
  $effect.pre(() => {
    const base = baseNodes();
    if (base === reconciledFrom) return;
    reconciledFrom = base;
    nodes = preserveDraggedPositions(untrack(() => nodes), base);
  });

  let history: McdNode[][] = [];
  let future: McdNode[][] = [];
  let dragSnapshot: McdNode[] | null = null;

  const undo = () => {
    const prev = history.pop();
    if (!prev) return;
    future.push(nodes);
    nodes = prev;
  };
  const redo = () => {
    const next = future.pop();
    if (!next) return;
    history.push(nodes);
    nodes = next;
  };

  $effect(() => {
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
  });

  return {
    get nodes() {
      return nodes;
    },
    set nodes(next: McdNode[]) {
      nodes = next;
    },
    /** Snapshot taken before the first frame moves anything — the state an undo returns to. */
    onDragStart: () => {
      if (dragSnapshot === null) dragSnapshot = nodes.map((n) => ({ ...n, dragging: false }) as McdNode);
    },
    onDragStop: () => {
      if (!dragSnapshot) return;
      history.push(dragSnapshot);
      future = [];
      dragSnapshot = null;
    },
    resetPositions: () => {
      history = [];
      future = [];
      nodes = untrack(baseNodes);
    },
  };
}
