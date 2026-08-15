import { useEffect, type RefObject } from "react";

/**
 * Calls `onOutsideClick` when a pointer press lands outside `ref` while
 * `active`.
 *
 * Listens for `mousedown`, not `click`: a `click` only fires after the button
 * is released, so a press that starts inside a popover and drags out (selecting
 * text, dragging a colour slider) would otherwise dismiss it.
 */
export function useOutsideClick(ref: RefObject<HTMLElement | null>, active: boolean, onOutsideClick: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOutsideClick();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [ref, active, onOutsideClick]);
}
