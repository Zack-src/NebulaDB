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
  let pending: CanvasPoint | null = null;
  let frame: number | null = null;

  return {
    onMouseMove(event: MouseEvent) {
      const current = awareness();
      if (!current) return;
      pending = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (pending) current.setLocalStateField("cursor", pending);
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
