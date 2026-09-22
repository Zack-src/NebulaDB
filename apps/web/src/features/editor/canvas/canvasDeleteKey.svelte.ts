import { getSelectedWaypoint } from "@/features/editor/edges/waypointSelection";
import { isTypingTarget } from "@/utils/dom";

/**
 * Delete/Backspace, owned here instead of by the flow's own `deleteKey`.
 *
 * The flow binds that key itself and deletes the whole selection without
 * asking anyone else — so pressing Delete with an edge waypoint selected
 * removed the entire relation from the schema, while the waypoint's own
 * handler ran too. One handler with an explicit order of precedence is the
 * only way to make "delete this corner" and "delete this table" the same key:
 * the waypoint claims the keystroke first, and everything else falls through
 * to the normal selection delete.
 *
 * `canWrite` is read at keydown time rather than re-binding the listener on
 * every permission re-evaluation — it only needs the *current* value.
 */
export function useCanvasDeleteKey(options: {
  canWrite: () => boolean;
  selectedNodeIds: () => string[];
  selectedEdgeIds: () => string[];
  deleteNodes: (ids: string[]) => void;
  deleteEdges: (ids: string[]) => void;
}): void {
  $effect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      if (!options.canWrite()) return;
      if (getSelectedWaypoint()) return;
      const nodeIds = options.selectedNodeIds();
      const edgeIds = options.selectedEdgeIds();
      if (nodeIds.length === 0 && edgeIds.length === 0) return;
      event.preventDefault();
      // Edges first: a table's own delete also removes every ref touching it,
      // and doing the refs the user explicitly selected first keeps that a
      // no-op rather than a double delete.
      if (edgeIds.length > 0) options.deleteEdges(edgeIds);
      if (nodeIds.length > 0) options.deleteNodes(nodeIds);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}
