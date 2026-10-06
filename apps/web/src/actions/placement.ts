/** Keep-clear gap between a menu and the window edge. */
const MARGIN = 8;
/** Gap between a popover and the control it hangs off. */
const ANCHOR_GAP = 6;
/** Below this a flipped popover is not worth it — it scrolls instead. */
const MIN_PANEL_HEIGHT = 160;

/**
 * Places a `position: fixed` menu at a click point, flipping to the other side of the cursor
 * when there isn't room and clamping as a last resort. Runs after insertion and before paint,
 * so the first painted frame is already placed.
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
  side?: "bottom" | "top" | "right";
  /** Never narrower than the control it hangs off — a select's list under its trigger. */
  matchWidth?: boolean;
}

/**
 * Places a popover against the control that opened it: below by default, flipped above when
 * there is more room there, always inside the window, with a `maxHeight` derived from the
 * trigger's real rect so long lists scroll inside themselves.
 *
 * `side: "right"` anchors to the right of `rect` (flipping left), top-aligned; `side: "top"` is
 * the mirror of the default. The element starts `visibility: hidden`; this reveals it.
 */
export function anchoredPlacement(node: HTMLElement, params: AnchoredPlacementParams) {
  const place = ({ rect, side = "bottom", matchWidth = false }: AnchoredPlacementParams) => {
    if (!rect) return;
    const style = node.style;
    // Set before anything is measured: it changes the width the rest reads.
    if (matchWidth) style.minWidth = `${rect.width}px`;

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
    const flip =
      side === "top" ? !(node.scrollHeight > above && below > above) : below < MIN_PANEL_HEIGHT && above > below;

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
