import { useStore, type Viewport } from "@xyflow/svelte";

/**
 * Closes a canvas-anchored popover the moment the viewport pans or zooms.
 * These popovers are positioned with `position: fixed` from the anchor's
 * on-screen rect at open time — panning/zooming the canvas moves the table
 * underneath but not the popover, so leaving it open makes it visibly detach
 * from whatever it's editing instead of just closing like every other dismiss
 * path already does.
 *
 * The viewport is only subscribed to *while open*: every column row carries
 * one of these popovers, and thousands of idle subscriptions re-running on
 * every pan frame would cost more than the popovers themselves.
 *
 * Must be called from a component mounted inside `<SvelteFlow>`.
 */
export function useCloseOnViewportChange(open: () => boolean, onDismiss: () => void): void {
  const store = useStore();
  let openedAt: Viewport | null = null;
  $effect(() => {
    if (!open()) {
      openedAt = null;
      return;
    }
    const viewport = store.viewport;
    if (openedAt === null) {
      openedAt = viewport;
      return;
    }
    if (viewport !== openedAt) onDismiss();
  });
}
