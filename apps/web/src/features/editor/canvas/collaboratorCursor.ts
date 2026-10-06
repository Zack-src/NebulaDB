import type { Awareness } from "y-protocols/awareness.js";
import type { CanvasPoint } from "./types";

/**
 * Collaborator cursor broadcast, throttled to one animation frame.
 *
 * `mousemove` fires far faster than anything anyone can see — several times
 * per frame on a high-polling mouse — and every call put an awareness update
 * on the WebSocket *and* updated every peer's `RemoteCursorsLayer`. One
 * position per frame is the most that can ever be displayed, so the rest was
 * pure load on the socket and on every peer.
 */
export function createCollaboratorCursor(
  awareness: () => Awareness | null,
  screenToFlowPosition: (point: { x: number; y: number }) => CanvasPoint,
) {
  // Screen coordinates: converting to flow space reads the canvas's bounding
  // rect, so it is done once per frame with the broadcast, not once per event.
  let pending: { x: number; y: number } | null = null;
  let frame: number | null = null;

  return {
    onMouseMove(event: MouseEvent) {
      const current = awareness();
      if (!current) return;
      pending = { x: event.clientX, y: event.clientY };
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (pending) current.setLocalStateField("cursor", screenToFlowPosition(pending));
      });
    },
    onMouseLeave() {
      pending = null;
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      awareness()?.setLocalStateField("cursor", null);
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
