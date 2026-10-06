import { useStore, type Viewport } from "@xyflow/svelte";

/**
 * Closes a canvas-anchored popover when the viewport pans or zooms: these popovers are
 * `position: fixed` from the anchor's rect at open time and would visibly detach. The viewport
 * is only subscribed to *while open*, since every column row carries one of these popovers.
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
