import { useEffect, type RefObject } from "react";
import { useEscapeKey } from "./useEscapeKey";

/**
 * Closes a popover on Escape or on a click outside any of its `refs`.
 *
 * Listens for `click`, not `mousedown`: React Flow's pane stops mousedown
 * propagation for its own pan/drag handling, so a mousedown listener never sees
 * clicks on the canvas — which is exactly where these popovers live. Every
 * canvas popover had its own copy of this pair of listeners, and the ones that
 * used `mousedown` stayed open when the user clicked the diagram.
 */
export function useDismissablePopover(
  open: boolean,
  onDismiss: () => void,
  refs: RefObject<HTMLElement | null>[],
): void {
  useEscapeKey(open, onDismiss);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onDismiss();
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
    // `refs` is a fresh array literal at every call site; spreading its
    // contents keeps the effect keyed on the elements rather than the wrapper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss, ...refs]);
}
