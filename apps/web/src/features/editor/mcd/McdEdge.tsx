import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { McdCardinality } from "@athanordb/shared";

export interface McdEdgeData {
  /** The Merise `min,max` pair for this leg — shown as a chip at the midpoint of the line. */
  cardinality: McdCardinality;
  [key: string]: unknown;
}

export type McdEdgeType = Edge<McdEdgeData, "mcd">;

/**
 * One leg of a Merise association: a straight line with right-angle bends
 * (same `smoothstep`-family shape the MLD canvas's own ref lines use — a
 * free-curving bezier read as "unrelated to the rest of the app"), from an
 * entity to its association diamond, labelled with the Merise `min,max` pair
 * instead of a crow's foot.
 */
export function McdEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<McdEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 0,
  });

  return (
    <>
      {/* interactionWidth={0}: no invisible hit-path — these lines are purely informational (nothing to click), so React Flow's default 20px hit area would only add a pointer cursor with nothing behind it. */}
      <BaseEdge id={id} path={path} interactionWidth={0} style={{ stroke: "var(--color-border)", strokeWidth: 1.5 }} />
      {data?.cardinality && (
        <EdgeLabelRenderer>
          <div
            className="absolute rounded-full border border-primary-border bg-surface px-1.5 py-px font-mono text-[10.5px] font-semibold text-primary-hover"
            style={{ left: 0, top: 0, transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.cardinality}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
