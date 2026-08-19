import { useOnViewportChange } from "@xyflow/react";

/**
 * Closes a canvas-anchored popover the moment the viewport starts panning or
 * zooming. These popovers are positioned with `position: fixed` from the
 * anchor's on-screen rect at open time — panning/zooming the canvas moves the
 * table underneath but not the popover, so leaving it open makes it visibly
 * detach from whatever it's editing instead of just closing like every other
 * dismiss path already does.
 *
 * Must be called from a component mounted inside `<ReactFlowProvider>`.
 */
export function useCloseOnViewportChange(open: boolean, onDismiss: () => void): void {
  useOnViewportChange({
    onStart: () => {
      if (open) onDismiss();
    },
  });
}
