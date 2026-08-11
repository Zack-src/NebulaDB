import { EdgeLabelRenderer, useViewport, type Edge, type EdgeProps } from "@xyflow/react";
import type { RefCardinality, RoutingPoint } from "@athanordb/shared";
import { useEdgeRouting } from "@/features/editor/edges/useEdgeRouting";
import { useEdgeSplitPath } from "@/features/editor/edges/useEdgeSplitPath";
import { EdgeWaypoints } from "@/features/editor/edges/EdgeWaypoints";
import { CardinalityBadge } from "@/features/editor/edges/CardinalityBadge";
import { EdgeContextMenu } from "@/features/editor/edges/EdgeContextMenu";

export interface RefEdgeData {
  cardinality: RefCardinality;
  routingPoints?: RoutingPoint[];
  highlightLinks?: boolean;
  /** True when this edge touches the currently hovered or selected table — highlights it independently of the global `highlightLinks` toggle. */
  connectedHighlight?: boolean;
  /** Custom highlight color override — falls back to the cardinality's default color when unset. */
  color?: string;
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  onColorChange: (color: string | undefined) => void;
  onRoutingPointsChange: (points: RoutingPoint[] | undefined) => void;
  onDeleteRef?: () => void;
  [key: string]: unknown;
}

export type RefEdgeType = Edge<RefEdgeData, "ref">;

export const CARDINALITY_STYLE: Record<RefCardinality, { stroke: string; label: string }> = {
  "one-to-one": { stroke: "#818cf8", label: "1–1" },
  "one-to-many": { stroke: "#34d399", label: "1–n" },
  "many-to-many": { stroke: "#fbbf24", label: "n–n" },
};

export function RefEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<RefEdgeType>) {
  const style = CARDINALITY_STYLE[data?.cardinality ?? "one-to-many"];
  const isManyToMany = data?.cardinality === "many-to-many";

  const routing = useEdgeRouting({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    routingPoints: data?.routingPoints,
    onRoutingPointsChange: (points) => data?.onRoutingPointsChange(points),
  });
  const { measureRef, split } = useEdgeSplitPath(routing.fullPath);

  const labelX = split?.mid.x ?? routing.stepLabelX;
  const labelY = split?.mid.y ?? routing.stepLabelY;

  const isHighlighted = Boolean(data?.highlightLinks || data?.connectedHighlight || selected);
  const strokeColor = isHighlighted ? data?.color ?? style.stroke : "#475569";
  // Path coordinates live in flow space, which React Flow scales down via a
  // CSS transform as the user zooms out — so a fixed stroke-width/dasharray
  // shrinks to sub-pixel and disappears at low zoom. Dividing by zoom here
  // pre-compensates in flow units so the *rendered* (post-transform) size on
  // screen stays constant regardless of zoom level.
  const { zoom } = useViewport();
  const zoomCompensation = 1 / Math.max(zoom, 0.01);
  const strokeWidth = (selected ? 3 : isHighlighted ? 2.25 : 1.5) * zoomCompensation;
  const strokeOpacity = selected ? 1 : isHighlighted ? 0.85 : 0.45;
  const dotAnimation = isHighlighted ? `ref-edge-flow ${selected ? 0.5 : 0.8}s linear infinite` : "none";
  const strokeDasharray = isHighlighted ? `${0.1 * zoomCompensation} ${9 * zoomCompensation}` : "none";
  const showCardinalityBadge = isHighlighted;

  return (
    <>
      <path ref={measureRef} d={routing.fullPath} fill="none" stroke="none" style={{ pointerEvents: "none" }} />
      {isManyToMany && split ? (
        <>
          <path
            d={split.half1}
            fill="none"
            className="ref-edge-flow-path"
            style={{ stroke: strokeColor, strokeWidth, opacity: strokeOpacity, animation: dotAnimation, strokeDasharray, vectorEffect: "non-scaling-stroke" }}
          />
          <path
            d={split.half2}
            fill="none"
            markerEnd={markerEnd}
            className="ref-edge-flow-path"
            style={{ stroke: strokeColor, strokeWidth, opacity: strokeOpacity, animation: dotAnimation, strokeDasharray, vectorEffect: "non-scaling-stroke" }}
          />
        </>
      ) : (
        <path
          d={routing.fullPath}
          fill="none"
          markerEnd={markerEnd}
          className="ref-edge-flow-path"
          style={{ stroke: strokeColor, strokeWidth, opacity: strokeOpacity, animation: dotAnimation, strokeDasharray }}
        />
      )}
      <path
        d={routing.fullPath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: "copy" }}
        onDoubleClick={routing.handlePathDoubleClick}
        onContextMenu={(event) => routing.openContextMenu(event)}
      />
      <EdgeLabelRenderer>
        <EdgeWaypoints
          points={routing.points}
          selectedIndex={routing.selectedPointIndex}
          strokeColor={strokeColor}
          onStartDrag={routing.startDrag}
          onSelect={routing.setSelectedPointIndex}
          onContextMenu={routing.openContextMenu}
        />
        {showCardinalityBadge && data && (
          <CardinalityBadge
            x={labelX}
            y={labelY}
            label={style.label}
            color={strokeColor}
            palette={data.palette}
            onPaletteChange={data.onPaletteChange}
            onColorChange={data.onColorChange}
            showReset={routing.hasCustomRouting || routing.points.length !== routing.defaultCorners.length}
            onReset={routing.resetRouting}
            onContextMenu={(event) => routing.openContextMenu(event)}
          />
        )}
        {routing.contextMenu && (
          <EdgeContextMenu
            menu={routing.contextMenu}
            onDeletePoint={routing.deletePointAt}
            onResetRouting={routing.resetRouting}
            onResetColor={data?.color ? () => data.onColorChange(undefined) : undefined}
            onDeleteRef={
              data?.onDeleteRef
                ? () => {
                    data.onDeleteRef?.();
                    routing.closeContextMenu();
                  }
                : undefined
            }
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}
