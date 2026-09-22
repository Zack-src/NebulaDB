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
 * An action rather than state: it measures and writes `left`/`top` straight
 * onto the element after it is inserted and before the browser paints, so the
 * first painted frame is already in the right place — no visible jump, and no
 * second render pass.
 */
export function menuPlacement(node: HTMLElement, point: { x: number; y: number }) {
  const place = ({ x, y }: { x: number; y: number }) => {
    const { offsetWidth: width, offsetHeight: height } = node;

    let left = x;
    if (x + width > window.innerWidth - MARGIN) left = x - width;
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - width - MARGIN));

    let top = y;
    if (y + height > window.innerHeight - MARGIN) top = y - height;
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - height - MARGIN));

    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  };
  place(point);
  return { update: place };
}

export interface AnchoredPlacementParams {
  rect: DOMRect | null;
  side?: "bottom" | "right";
}

/**
 * Places a popover against the control that opened it, rather than at a bare
 * point: below by default, flipped above when there is more room there, always
 * inside the window, and always with a `maxHeight` so a long list scrolls
 * inside itself instead of running off the screen.
 *
 * `side: "right"` anchors instead to the right of `rect` (flipping to the
 * left when there isn't room), top-aligned with `rect` — used for popovers
 * that should sit beside the thing they edit rather than drop down over it.
 *
 * The height cap is the part the hand-rolled versions all got wrong — each
 * clamped its position against a *guessed* height constant while the element
 * itself was free to grow to `80vh`, so tall popovers hung off the bottom
 * anyway. Deriving the cap from the trigger's real rect removes the guess.
 *
 * The element is expected to start `visibility: hidden` at a provisional
 * position; this reveals it once placed.
 */
export function anchoredPlacement(node: HTMLElement, params: AnchoredPlacementParams) {
  const place = ({ rect, side = "bottom" }: AnchoredPlacementParams) => {
    if (!rect) return;
    const style = node.style;

    if (side === "right") {
      const width = node.offsetWidth;
      const right = rect.right + ANCHOR_GAP;
      const fitsRight = right + width <= window.innerWidth - MARGIN;
      const left = fitsRight ? right : Math.max(MARGIN, rect.left - ANCHOR_GAP - width);

      const top = Math.max(MARGIN, Math.min(rect.top, window.innerHeight - MIN_PANEL_HEIGHT - MARGIN));
      const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - top - MARGIN);

      style.left = `${left}px`;
      style.top = `${top}px`;
      style.maxHeight = `${maxHeight}px`;
      style.overflowY = "auto";
      style.visibility = "";
      return;
    }

    const width = node.offsetWidth;
    const below = window.innerHeight - rect.bottom - ANCHOR_GAP - MARGIN;
    const above = rect.top - ANCHOR_GAP - MARGIN;
    const flip = below < MIN_PANEL_HEIGHT && above > below;

    const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, window.innerWidth - width - MARGIN));
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, flip ? above : below);
    const top = flip
      ? Math.max(MARGIN, rect.top - ANCHOR_GAP - Math.min(node.scrollHeight, maxHeight))
      : rect.bottom + ANCHOR_GAP;

    style.left = `${left}px`;
    style.top = `${top}px`;
    style.maxHeight = `${maxHeight}px`;
    style.overflowY = "auto";
    style.visibility = "";
  };
  place(params);
  return { update: place };
}

/** The provisional style a popover renders with before `anchoredPlacement` measures it. */
export function provisionalPopoverStyle(rect: DOMRect): string {
  return `left:${rect.left}px;top:${rect.bottom + 6}px;visibility:hidden`;
}
