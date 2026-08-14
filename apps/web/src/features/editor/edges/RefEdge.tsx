import { useMemo } from "react";
import { EdgeLabelRenderer, useViewport, type Edge, type EdgeProps } from "@xyflow/react";
import type { RefCardinality, RoutingPoint } from "@athanordb/shared";
import { useEdgeRouting } from "@/features/editor/edges/useEdgeRouting";
import { polylinePath, splitPolylineAtMidpoint } from "@/features/editor/edges/pathMath";
import { EdgeWaypoints } from "@/features/editor/edges/EdgeWaypoints";
import { CardinalityBadge } from "@/features/editor/edges/CardinalityBadge";
import { EdgeCardinalityLabels, ENDPOINT_CARDINALITY } from "@/features/editor/edges/EdgeCardinalityLabels";
import { EdgeContextMenu } from "@/features/editor/edges/EdgeContextMenu";

export interface RefEdgeData {
  cardinality: RefCardinality;
  /** Rank among the refs sharing this edge's source/target handle — shifts the cardinality chip so co-located refs don't stack on one spot. */
  sourceSlot?: number;
  targetSlot?: number;
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

/** Colour of a relation nobody is looking at — deliberately low-contrast so a dense schema reads as structure rather than spaghetti. */
const DIMMED_STROKE = "#475569";
/** Arrowhead size in screen pixels, before the zoom counter-scale. */
const ARROW_LENGTH = 9;
const ARROW_HALF_WIDTH = 5;

/**
 * Arrowhead drawn as part of the edge instead of an SVG `marker-end`.
 *
 * A marker is defined once, up front, with a fixed colour, and React Flow
 * sizes it in `strokeWidth` units — so it stayed the relation's bright colour
 * on a dimmed line and doubled in size the moment the edge was selected.
 * Drawing it here keeps colour, opacity and size in step with the stroke it
 * belongs to.
 */
function EdgeArrowhead(props: { points: { x: number; y: number }[]; color: string; opacity: number; scale: number }) {
  const { points, color, opacity, scale } = props;
  if (points.length < 2) return null;
  const tip = points[points.length - 1];
  const previous = points[points.length - 2];
  if (tip.x === previous.x && tip.y === previous.y) return null;

  const angle = (Math.atan2(tip.y - previous.y, tip.x - previous.x) * 180) / Math.PI;
  const length = ARROW_LENGTH * scale;
  const halfWidth = ARROW_HALF_WIDTH * scale;

  return (
    <polygon
      points={`0,0 ${-length},${-halfWidth} ${-length},${halfWidth}`}
      fill={color}
      opacity={opacity}
      transform={`translate(${tip.x} ${tip.y}) rotate(${angle})`}
      style={{ pointerEvents: "none" }}
    />
  );
}

export function RefEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RefEdgeType>) {
  const style = CARDINALITY_STYLE[data?.cardinality ?? "one-to-many"];
  const isManyToMany = data?.cardinality === "many-to-many";

  const routing = useEdgeRouting({
    edgeId: id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    routingPoints: data?.routingPoints,
    onRoutingPointsChange: (points) => data?.onRoutingPointsChange(points),
  });

  // Pure geometry, so it costs nothing for the edges that never use it and
  // never lands a frame behind the line the way measuring the rendered
  // `<path>` did.
  const split = useMemo(() => splitPolylineAtMidpoint(routing.drawnPoints), [routing.drawnPoints]);
  const labelX = split?.mid.x ?? routing.stepLabelX;
  const labelY = split?.mid.y ?? routing.stepLabelY;

  const isHighlighted = Boolean(data?.highlightLinks || data?.connectedHighlight || selected);
  const strokeColor = isHighlighted ? data?.color ?? style.stroke : DIMMED_STROKE;
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
  const strokeStyle = { stroke: strokeColor, strokeWidth, opacity: strokeOpacity, animation: dotAnimation, strokeDasharray };
  // Waypoint dots and the action toolbar are editing chrome — dbdiagram only
  // shows them once you've actually selected the line, so an unselected
  // schema with lots of overlapping refs doesn't turn into a field of dots.
  const showEditingControls = selected;
  const [sourceCardinality, targetCardinality] = ENDPOINT_CARDINALITY[data?.cardinality ?? "one-to-many"];

  return (
    <>
      {isManyToMany && split ? (
        // Split in two so each half animates on its own; both halves still run
        // source → target, which is what keeps the dash flow and the arrowhead
        // pointing the same way as every other cardinality.
        <>
          <path d={polylinePath(split.first)} fill="none" className="ref-edge-flow-path" style={strokeStyle} />
          <path d={polylinePath(split.second)} fill="none" className="ref-edge-flow-path" style={strokeStyle} />
        </>
      ) : (
        <path d={routing.fullPath} fill="none" className="ref-edge-flow-path" style={strokeStyle} />
      )}
      <EdgeArrowhead points={routing.drawnPoints} color={strokeColor} opacity={strokeOpacity} scale={zoomCompensation} />
      {/* Invisible fat stroke carrying the pointer interactions. Its width is
          zoom-compensated too, otherwise the grab area for double-click and
          right-click narrows to nothing exactly when the line is hardest to
          hit. */}
      <path
        d={routing.fullPath}
        fill="none"
        stroke="transparent"
        strokeWidth={16 * zoomCompensation}
        style={{ cursor: "copy" }}
        onDoubleClick={routing.handlePathDoubleClick}
        onContextMenu={(event) => routing.openContextMenu(event)}
      />
      <EdgeLabelRenderer>
        {isHighlighted && (
          <EdgeCardinalityLabels
            points={routing.drawnPoints}
            sourceLabel={sourceCardinality}
            targetLabel={targetCardinality}
            sourceSlot={data?.sourceSlot ?? 0}
            targetSlot={data?.targetSlot ?? 0}
            color={strokeColor}
            opacity={selected ? 1 : 0.95}
            zoom={zoom}
          />
        )}
        {showEditingControls && (
          <EdgeWaypoints
            points={routing.points}
            selectedIndex={routing.selectedPointIndex}
            strokeColor={strokeColor}
            zoom={zoom}
            onStartDrag={routing.startDrag}
            onSelect={routing.setSelectedPointIndex}
            onContextMenu={routing.openContextMenu}
          />
        )}
        {showEditingControls && data && (
          <CardinalityBadge
            x={labelX}
            y={labelY}
            label={style.label}
            color={strokeColor}
            zoom={zoom}
            palette={data.palette}
            onPaletteChange={data.onPaletteChange}
            onColorChange={data.onColorChange}
            showReset={routing.hasCustomRouting || routing.points.length !== routing.defaultCorners.length}
            onReset={routing.resetRouting}
            onOpenSettings={(event) => routing.openContextMenu(event)}
            onContextMenu={(event) => routing.openContextMenu(event)}
          />
        )}
        {routing.contextMenu && (
          <EdgeContextMenu
            menu={routing.contextMenu}
            onClose={routing.closeContextMenu}
            onInsertPoint={routing.insertPointAt}
            onDeletePoint={routing.deletePointAt}
            onResetRouting={routing.resetRouting}
            onResetColor={data?.color ? () => data.onColorChange(undefined) : undefined}
            onDeleteRef={data?.onDeleteRef}
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}
