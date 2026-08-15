// Fallback size used the instant a table/zone/sticky mounts, before React
// Flow's ResizeObserver reports its real `measured` box — self-corrects on
// the next render once the real size lands, so accuracy here barely matters.
export const DEFAULT_TABLE_WIDTH = 220;
export const DEFAULT_TABLE_HEIGHT = 120;

export interface TableBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Chooses which side (left/right) each end of a ref should exit/enter from.
 * Side-by-side tables get opposite sides (exit toward the other table, the
 * shortest path). Vertically stacked tables — bounding boxes overlap on X —
 * get the *same* side instead: opposite sides would force the smoothstep
 * router to swing all the way across the full table width and back just to
 * reach the far side, an unnecessary detour for tables sitting one above
 * the other.
 */
export function pickHandleSides(
  from: TableBox,
  to: TableBox,
): { fromSide: "left" | "right"; toSide: "left" | "right" } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  const overlapX = (from.width + to.width) / 2 - Math.abs(dx);
  const overlapY = (from.height + to.height) / 2 - Math.abs(dy);
  const stackedVertically = overlapX > 0 && overlapY <= 0;

  if (stackedVertically) {
    const side = dx >= 0 ? "right" : "left";
    return { fromSide: side, toSide: side };
  }
  return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
}
