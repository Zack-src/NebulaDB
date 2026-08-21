import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useReactFlow } from "@xyflow/react";
import type { Awareness } from "y-protocols/awareness.js";
import type { CanvasPoint } from "./types";

/**
 * Collaborator cursor broadcast, throttled to one animation frame.
 *
 * `mousemove` fires far faster than anything anyone can see — several times
 * per frame on a high-polling mouse — and every call put an awareness update
 * on the WebSocket *and* re-rendered every peer's `RemoteCursorsLayer`. One
 * position per frame is the most that can ever be displayed, so the rest was
 * pure load on the socket and on every peer.
 *
 * Split out of `CanvasArea` — self-contained (its own refs, no state the rest
 * of the component reads) and one of the few pieces that could plausibly be
 * reused (a future second canvas surface would want the same throttling).
 */
export function useCollaboratorCursor(awareness: Awareness | null) {
  const { screenToFlowPosition } = useReactFlow();
  const pendingCursorRef = useRef<CanvasPoint | null>(null);
  const cursorFrameRef = useRef<number | null>(null);

  const onMouseMove = useCallback(
    (event: ReactMouseEvent) => {
      if (!awareness) return;
      pendingCursorRef.current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (cursorFrameRef.current !== null) return;
      cursorFrameRef.current = requestAnimationFrame(() => {
        cursorFrameRef.current = null;
        if (pendingCursorRef.current) awareness.setLocalStateField("cursor", pendingCursorRef.current);
      });
    },
    [awareness, screenToFlowPosition],
  );

  const onMouseLeave = useCallback(() => {
    pendingCursorRef.current = null;
    if (cursorFrameRef.current !== null) {
      cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null;
    }
    awareness?.setLocalStateField("cursor", null);
  }, [awareness]);

  useEffect(
    () => () => {
      if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current);
    },
    [],
  );

  return { onMouseMove, onMouseLeave };
}
