import { useEffect } from "react";

/**
 * Runs `onEscape` while `active`. Thirteen components each registered their own
 * `keydown` listener for this; the subtle part they kept getting slightly
 * different is `stopPropagation` — without it, Escape inside a popover that
 * sits in a modal closes both at once.
 */
export function useEscapeKey(active: boolean, onEscape: () => void, options: { stopPropagation?: boolean } = {}): void {
  const { stopPropagation = true } = options;

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stopPropagation) event.stopPropagation();
      onEscape();
    };
    // Capture phase: the innermost open layer sees the key first, so the
    // topmost thing closes rather than whatever happens to be focused.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, onEscape, stopPropagation]);
}
