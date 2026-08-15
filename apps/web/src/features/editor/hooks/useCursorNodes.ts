import { useMemo } from "react";
import type { CursorNodeType } from "@/features/collaboration/CursorNode";
import type { AwarenessState } from "@/features/collaboration/yjsClient";

/** Turns remote peers' awareness state into React Flow nodes for their live cursors. */
export function useCursorNodes(remoteAwareness: Map<number, AwarenessState>): CursorNodeType[] {
  return useMemo(() => {
    const result: CursorNodeType[] = [];
    remoteAwareness.forEach((state, clientId) => {
      if (!state.cursor) return;
      result.push({
        id: `cursor-${clientId}`,
        position: state.cursor,
        type: "cursor",
        // Declared up front rather than left to post-mount measurement: React Flow only lifts a node's
        // `visibility: hidden` placeholder once it has *some* non-zero width/height, either from this or from a
        // ResizeObserver pass over the rendered content (see CursorNode's comment) — without one of the two, a
        // remote cursor stayed invisible forever.
        width: 1,
        height: 1,
        draggable: false,
        selectable: false,
        deletable: false,
        focusable: false,
        zIndex: 1000,
        data: { name: state.user.name, color: state.user.color },
      });
    });
    return result;
  }, [remoteAwareness]);
}
