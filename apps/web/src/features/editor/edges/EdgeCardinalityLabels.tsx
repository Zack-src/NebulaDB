import { endpointLabelAnchor, polylineLength, type Point } from "@/features/editor/edges/pathMath";

/** Screen-space geometry for the chips — converted to flow units at render time so zoom never changes what the user sees. */
const ALONG = 18;
const AWAY = 12;
/**
 * Spacing for several refs landing on the same column handle, applied
 * perpendicular to the line.
 *
 * Measured against the alternative on a 26-table schema: staggering *along* the
 * segment instead slid each extra chip horizontally into the column band above
 * or below it and nearly doubled the number of touching pairs, because table
 * rows are only ~27px apart vertically. Pushing away from the line keeps each
 * chip in its own row band.
 */
const SLOT_STEP = 15;
/** Below this the two chips (plus the midpoint toolbar) would collide, so the edge goes unlabelled rather than unreadable. */
const MIN_PATH = 56;

/** "one-to-many" -> ["1", "n"], etc. — dbdiagram's per-endpoint convention, as opposed to this app's own combined "1–n" pill at the midpoint. */
export const ENDPOINT_CARDINALITY: Record<"one-to-one" | "one-to-many" | "many-to-many", [string, string]> = {
  "one-to-one": ["1", "1"],
  "one-to-many": ["1", "n"],
  "many-to-many": ["n", "n"],
};

/**
 * The "1"/"n" markers at each end of a ref, dbdiagram-style — shown alongside
 * (not instead of) the midpoint pill, which is this app's own addition and
 * stays because it's also where the edge's colour/reset/settings controls live.
 *
 * Three things make them readable where a bare span was not:
 *  - they sit *beside* the line (perpendicular offset), not centred on it;
 *  - they're opaque chips, so a line crossing behind one doesn't run through
 *    the glyph the way it did through a text-shadow halo;
 *  - refs sharing a column handle get stacked by slot index instead of being
 *    drawn one exactly on top of the other.
 *
 * Sizes are divided by zoom because the edge-label layer rides React Flow's
 * viewport transform: without it a chip is illegibly small zoomed out and
 * absurd zoomed in, while the stroke it annotates stays constant.
 */
export function EdgeCardinalityLabels(props: {
  points: Point[];
  sourceLabel: string;
  targetLabel: string;
  sourceSlot: number;
  targetSlot: number;
  color: string;
  opacity: number;
  zoom: number;
}) {
  const { points, color, opacity, zoom } = props;
  const scale = 1 / Math.max(zoom, 0.01);
  if (points.length < 2 || polylineLength(points) < MIN_PATH * scale) return null;

  const source = endpointLabelAnchor(points, false, ALONG * scale, (AWAY + props.sourceSlot * SLOT_STEP) * scale);
  const target = endpointLabelAnchor(points, true, ALONG * scale, (AWAY + props.targetSlot * SLOT_STEP) * scale);

  const chip = (point: Point, label: string, key: string) => (
    <span
      key={key}
      className="ref-edge-cardinality"
      style={{
        left: 0,
        top: 0,
        transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%) scale(${scale})`,
        transformOrigin: "center center",
        color,
        borderColor: color,
        opacity,
      }}
    >
      {label}
    </span>
  );

  return (
    <>
      {source && chip(source, props.sourceLabel, "source")}
      {target && chip(target, props.targetLabel, "target")}
    </>
  );
}
