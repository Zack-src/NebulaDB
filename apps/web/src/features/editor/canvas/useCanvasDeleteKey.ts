import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { getSelectedWaypoint } from "@/features/editor/edges/waypointSelection";
import { isTypingTarget } from "@/utils/dom";

/**
 * Delete/Backspace, owned here instead of by React Flow's `deleteKeyCode`.
 *
 * React Flow binds that key on `document` and deletes the whole selection
 * without asking anyone else — so pressing Delete with an edge waypoint
 * selected removed the entire relation from the schema, while the waypoint's
 * own handler ran too. One handler with an explicit order of precedence is
 * the only way to make "delete this corner" and "delete this table" the same
 * key: the waypoint claims the keystroke first, and everything else falls
 * through to the normal selection delete.
 *
 * `canWrite` is read through a ref rather than as a `useEffect` dependency so
 * the listener isn't torn down and re-attached on every permission
 * re-evaluation (see `Room`'s `ACCESS_TTL_MS` on the server) — it only needs
 * the *current* value at keydown time.
 */
export function useCanvasDeleteKey(canWrite: boolean) {
  const { deleteElements, getNodes, getEdges } = useReactFlow();
  const canWriteRef = useRef(canWrite);
  useEffect(() => {
    canWriteRef.current = canWrite;
  }, [canWrite]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      if (!canWriteRef.current) return;
      if (getSelectedWaypoint()) return;
      const nodes = getNodes().filter((node) => node.selected);
      const edges = getEdges().filter((edge) => edge.selected);
      if (nodes.length === 0 && edges.length === 0) return;
      event.preventDefault();
      void deleteElements({ nodes, edges });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteElements, getNodes, getEdges]);
}
