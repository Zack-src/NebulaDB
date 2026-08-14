import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** Keep-clear gap between a menu and the window edge. */
const MARGIN = 8;

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
