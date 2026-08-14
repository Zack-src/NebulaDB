import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

/** Keep-clear gap between a menu and the window edge. */
const MARGIN = 8;
/** Gap between a popover and the control it hangs off. */
const ANCHOR_GAP = 6;
/** Below this a flipped popover is not worth it — it scrolls instead. */
const MIN_PANEL_HEIGHT = 160;

/**
 * Places a `position: fixed` menu at a click point without letting it run off
 * screen: it flips to the other side of the cursor when there isn't room, and
 * clamps as a last resort. Right-clicking near the bottom-right of the window
 * is completely ordinary, and an unclamped menu simply puts half its items
 * where they cannot be reached.
 *
 * Measurement happens in a layout effect, so the first painted frame is already
 * in the right place — no visible jump.
 */
export function useMenuPlacement(x: number, y: number): {
  ref: React.RefObject<HTMLDivElement | null>;
  style: CSSProperties;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { offsetWidth: width, offsetHeight: height } = element;

    let left = x;
    if (x + width > window.innerWidth - MARGIN) left = x - width;
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - width - MARGIN));

    let top = y;
    if (y + height > window.innerHeight - MARGIN) top = y - height;
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - height - MARGIN));

    setPlacement({ left, top });
  }, [x, y]);

  return { ref, style: { left: placement.left, top: placement.top } };
}

/**
 * Places a popover against the control that opened it, rather than at a bare
 * point: below by default, flipped above when there is more room there, always
 * inside the window, and always with a `maxHeight` so a long list scrolls
 * inside itself instead of running off the screen.
 *
 * The height cap is the part the hand-rolled versions all got wrong — each
 * clamped its position against a *guessed* height constant while the element
 * itself was free to grow to `80vh`, so tall popovers hung off the bottom
 * anyway. Deriving the cap from the trigger's real rect removes the guess.
 *
 * Takes the caller's own ref instead of creating one, because these popovers
 * already hand a ref to `useDismissablePopover`.
 */
export function useAnchoredPlacement(
  rect: DOMRect | null,
  ref: RefObject<HTMLElement | null>,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!rect || !element) return;

    const width = element.offsetWidth;
    const below = window.innerHeight - rect.bottom - ANCHOR_GAP - MARGIN;
    const above = rect.top - ANCHOR_GAP - MARGIN;
    const flip = below < MIN_PANEL_HEIGHT && above > below;

    const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, window.innerWidth - width - MARGIN));
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, flip ? above : below);
    const top = flip ? Math.max(MARGIN, rect.top - ANCHOR_GAP - Math.min(element.scrollHeight, maxHeight)) : rect.bottom + ANCHOR_GAP;

    setStyle({ left, top, maxHeight, overflowY: "auto" });
  }, [rect, ref]);

  return style;
}
