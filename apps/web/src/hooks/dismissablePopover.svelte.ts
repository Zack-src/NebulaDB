import { useEscapeKey } from "./escapeKey.svelte";

/**
 * Closes a popover on Escape or on a click outside any of `elements()`.
 *
 * Listens for `click`, not `mousedown`: the canvas pane stops mousedown
 * propagation for its own pan/drag handling, so a mousedown listener never
 * sees clicks on the canvas — which is exactly where these popovers live.
 * Every canvas popover had its own copy of this pair of listeners, and the
 * ones that used `mousedown` stayed open when the user clicked the diagram.
 */
export function useDismissablePopover(
  open: () => boolean,
  onDismiss: () => void,
  elements: () => (HTMLElement | null | undefined)[],
): void {
  useEscapeKey(open, onDismiss);

  $effect(() => {
    if (!open()) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (elements().some((element) => element?.contains(target))) return;
      onDismiss();
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  });
}
