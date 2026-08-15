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

/**
 * Cuts a polyline in two at the halfway point of its own length, returning the
 * exact split point plus both halves as point lists.
 *
 * Computed from the geometry rather than by sampling the rendered
 * `<path>` with `getPointAtLength`: sampling forced a synchronous layout on
 * every edge on every path change, rounded off every corner of an orthogonal
 * route into a 16-segment approximation, and produced the second half
 * *backwards* (target → middle), which is why the many-to-many arrowhead used
 * to sit at the midpoint pointing the wrong way.
 */
export function splitPolylineAtMidpoint(points: Point[]): { mid: Point; first: Point[]; second: Point[] } | null {
  if (points.length < 2) return null;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    lengths.push(d);
    total += d;
  }
  if (total === 0) return null;

  const half = total / 2;
  let travelled = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (travelled + lengths[i] >= half) {
      const t = lengths[i] === 0 ? 0 : (half - travelled) / lengths[i];
      const a = points[i];
      const b = points[i + 1];
      const mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return { mid, first: [...points.slice(0, i + 1), mid], second: [mid, ...points.slice(i + 1)] };
    }
    travelled += lengths[i];
  }
  const last = points[points.length - 1];
  return { mid: last, first: points, second: [last] };
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
  // Walk the polyline rather than the first segment alone: several refs sharing
  // a column are spaced out *along* the line, and on a short first leg every
  // one of them would otherwise be clamped back onto the same point — the exact
  // pile-up the spacing exists to prevent.
  const chain = atEnd ? [...points].reverse() : points;
  const total = polylineLength(chain);
  if (total < 1) return null;

  let travelled = 0;
  const target = Math.min(along, total * 0.45);
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const to = chain[i + 1];
    const segment = Math.hypot(to.x - from.x, to.y - from.y);
    if (segment < 0.001) continue;
    if (travelled + segment >= target) {
      const base = offsetAlong(from, to, target - travelled);
      const normal = perpendicular(from, to);
      return { x: base.x + normal.x * away, y: base.y + normal.y * away };
    }
    travelled += segment;
  }
  return null;
}

/** The point on segment `a`-`b` nearest to `p` — the click projected onto the line, so an inserted waypoint lands on the stroke rather than wherever the cursor happened to be. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Squared distance from `p` to its nearest point on segment `a`-`b`. */
function distToSegmentSq(p: Point, a: Point, b: Point): number {
  const proj = closestPointOnSegment(p, a, b);
  return (p.x - proj.x) ** 2 + (p.y - proj.y) ** 2;
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

export function getWaypointOrientation(
  index: number,
  points: Point[],
  source: Point,
  target: Point,
): "ew-resize" | "ns-resize" | "move" {
  const all = [source, ...points, target];
  const prev = all[index];
  const curr = all[index + 1];
  const next = all[index + 2];
  if (!curr) return "move";

  const prevIsVert = prev ? Math.abs(prev.x - curr.x) <= Math.abs(prev.y - curr.y) : false;
  const nextIsVert = next ? Math.abs(next.x - curr.x) <= Math.abs(next.y - curr.y) : false;

  // A vertical segment moves horizontally (ew-resize). A horizontal segment moves vertically (ns-resize).
  if (prevIsVert || nextIsVert) return "ew-resize";
  return "ns-resize";
}
