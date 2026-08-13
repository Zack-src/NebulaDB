import { offsetAlong, type Point } from "@/features/editor/edges/pathMath";

const ENDPOINT_OFFSET = 14;

/** "one-to-many" -> ["1", "n"], etc. — dbdiagram's per-endpoint convention, as opposed to this app's own combined "1–n" pill at the midpoint. */
export const ENDPOINT_CARDINALITY: Record<"one-to-one" | "one-to-many" | "many-to-many", [string, string]> = {
  "one-to-one": ["1", "1"],
  "one-to-many": ["1", "n"],
  "many-to-many": ["n", "n"],
};

/**
 * Small "1"/"n" markers planted just off each endpoint, dbdiagram-style —
 * shown alongside (not instead of) the midpoint pill, which is this app's
 * own addition and stays because it's also where the edge's color/reset/
 * settings controls live.
 */
export function EdgeCardinalityLabels(props: {
  allPoints: Point[];
  sourceLabel: string;
  targetLabel: string;
  color: string;
  opacity: number;
}) {
  const { allPoints, sourceLabel, targetLabel, color, opacity } = props;
  if (allPoints.length < 2) return null;

  const nearSource = offsetAlong(allPoints[0], allPoints[1], ENDPOINT_OFFSET);
  const nearTarget = offsetAlong(allPoints[allPoints.length - 1], allPoints[allPoints.length - 2], ENDPOINT_OFFSET);

  const labelStyle = (p: Point) => ({
    position: "absolute" as const,
    transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
    fontSize: 11,
    fontWeight: 800,
    color,
    opacity,
    pointerEvents: "none" as const,
    textShadow: "0 0 3px var(--color-bg-canvas), 0 0 3px var(--color-bg-canvas)",
  });

  return (
    <>
      <span style={labelStyle(nearSource)}>{sourceLabel}</span>
      <span style={labelStyle(nearTarget)}>{targetLabel}</span>
    </>
  );
}
