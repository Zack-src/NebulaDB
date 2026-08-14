export interface Point {
  x: number;
  y: number;
}

export function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/**
 * Expands a chain of waypoints into the corner-for-corner polyline that
 * actually gets drawn: any diagonal leg is replaced by a horizontal/vertical/
 * horizontal dog-leg through the midpoint. Callers that need to know which way
 * the line *leaves* an endpoint (cardinality chips, for one) have to read this
 * expanded list — the raw waypoints are diagonal and would point the label off
 * at an angle the drawn line never takes.
 */
export function orthogonalPolylinePoints(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    if (curr.x !== next.x && curr.y !== next.y) {
      const midX = (curr.x + next.x) / 2;
      result.push({ x: midX, y: curr.y });
      result.push({ x: midX, y: next.y });
    }
    result.push(next);
  }
  return result;
}

export function orthogonalPolylinePath(points: Point[]): string {
  if (points.length < 2) return "";
  return polylinePath(orthogonalPolylinePoints(points));
}

/** Total run of a polyline, used to decide whether a short edge has room for endpoint decorations at all. */
export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}

/**
 * Unit vector at right angles to `from`→`to`, with the sign pinned so the
 * result is predictable rather than dependent on which way the segment happens
 * to run: always *above* a horizontal leg, always to the *right* of a vertical
 * one. Without pinning, two mirror-image edges would push their labels to
 * opposite sides of the line and the diagram would read inconsistently.
 */
export function perpendicular(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal ? ny > 0 : nx < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/**
 * Where a cardinality chip goes for one end of a drawn polyline: `along` px in
 * from the endpoint, then `away` px clear of the line itself. Sitting the chip
 * *beside* the stroke rather than on top of it is the whole point — a label
 * centred on the line hides the very thing it annotates.
 */
export function endpointLabelAnchor(points: Point[], atEnd: boolean, along: number, away: number): Point | null {
  if (points.length < 2) return null;
  const from = atEnd ? points[points.length - 1] : points[0];
  const to = atEnd ? points[points.length - 2] : points[1];
  const segment = Math.hypot(to.x - from.x, to.y - from.y);
  if (segment < 1) return null;
  const base = offsetAlong(from, to, Math.min(along, segment * 0.6));
  const normal = perpendicular(from, to);
  return { x: base.x + normal.x * away, y: base.y + normal.y * away };
}

/** Squared distance from `p` to its nearest point on segment `a`-`b`, plus the segment-relative position of that projection (0..1). */
function distToSegmentSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return (p.x - projX) ** 2 + (p.y - projY) ** 2;
}

/**
 * Drops any point that's collinear (within `tolerance` px) with its
 * surviving neighbors — dragging a waypoint back onto the straight line
 * between its neighbors (most commonly: onto the straight source→target
 * line, once every point's been dragged into alignment) makes it dead
 * weight, and left in place it renders as a waypoint dot sitting right on
 * top of the cardinality label instead of routing anything.
 */
export function simplifyRoutingPoints(points: Point[], source: Point, target: Point, tolerance = 2): Point[] {
  const chain = [source, ...points, target];
  const kept: Point[] = [];
  for (let i = 1; i < chain.length - 1; i++) {
    const prev = kept.length > 0 ? kept[kept.length - 1] : chain[0];
    const curr = chain[i];
    const next = chain[i + 1];
    if (Math.sqrt(distToSegmentSq(curr, prev, next)) > tolerance) {
      kept.push(curr);
    }
  }
  return kept;
}

/** A point `distance` px from `from`, along the `from` -> `to` direction — used to plant a cardinality label just off an edge's endpoint. */
export function offsetAlong(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
}

/** Index of the segment (between `points[i]` and `points[i+1]`) closest to `p` — used to decide where a newly double-clicked waypoint gets inserted. */
export function closestSegmentIndex(points: Point[], p: Point): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegmentSq(p, points[i], points[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function getDefaultCornerPoints(pathString: string, startX: number, startY: number, endX: number, endY: number): Point[] {
  const points: Point[] = [];
  const regex = /[L]\s*(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(pathString)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const isStart = Math.abs(x - startX) < 4 && Math.abs(y - startY) < 4;
    const isEnd = Math.abs(x - endX) < 4 && Math.abs(y - endY) < 4;
    if (!isStart && !isEnd) {
      points.push({ x, y });
    }
  }
  return points;
}
