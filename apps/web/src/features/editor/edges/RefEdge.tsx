import { memo, useMemo, useState } from "react";
import { useStore, type Edge, type EdgeProps, type ReactFlowState } from "@xyflow/react";
import type { RefCardinality, RoutingPoint } from "@athanordb/shared";
import { useEdgeRouting } from "@/features/editor/edges/useEdgeRouting";
import { polylinePath, splitPolylineAtMidpoint } from "@/features/editor/edges/pathMath";
import { EdgeWaypoints } from "@/features/editor/edges/EdgeWaypoints";
import { CardinalityBadge } from "@/features/editor/edges/CardinalityBadge";
import { EdgeCardinalityLabels, ENDPOINT_CARDINALITY } from "@/features/editor/edges/EdgeCardinalityLabels";
import { EdgeContextMenu } from "@/features/editor/edges/EdgeContextMenu";
import { EdgeLabelPortal } from "@/features/editor/edges/EdgeLabelPortal";

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
  onCardinalityChange?: (cardinality: RefCardinality) => void;
  onReverseDirection?: () => void;
  onRoutingPointsChange: (points: RoutingPoint[] | undefined) => void;
  onDeleteRef?: () => void;
  onSelectEdge?: (id: string | null) => void;
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
 * How finely the zoom-compensation re-renders track the actual zoom level —
 * 5% steps are visually indistinguishable in stroke width/arrow size, but
 * turn "re-render on every one of ~60 viewport frames/second" into
 * "re-render on the handful of frames that actually cross a step". See the
 * `useStore` call below for why this matters at all (a wide schema has a lot
 * of edges, and each one used to pay this on every pan and zoom tick).
 */
const ZOOM_STEP = 0.05;
const zoomSelector = (state: ReactFlowState) => Math.round(state.transform[2] / ZOOM_STEP) * ZOOM_STEP;

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

// eslint-disable-next-line complexity -- edge rendering couples geometry (self-ref/many-to-many splitting), zoom-compensated styling and hover/selection state; a split would move shared derived values across files for no clarity gain
function RefEdgeImpl({
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
  const [isHovered, setIsHovered] = useState(false);
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

  const isHighlighted = Boolean(data?.highlightLinks || data?.connectedHighlight || selected || isHovered);
  const strokeColor = isHighlighted ? (data?.color ?? style.stroke) : DIMMED_STROKE;
  // Path coordinates live in flow space, which React Flow scales down via a
  // CSS transform as the user zooms out — so a fixed stroke-width/dasharray
  // shrinks to sub-pixel and disappears at low zoom. Dividing by zoom here
  // pre-compensates in flow units so the *rendered* (post-transform) size on
  // screen stays constant regardless of zoom level.
  //
  // Scoped to just the (step-quantized) zoom factor, not `useViewport()`'s
  // full `{x, y, zoom}` — x/y change on every single pan frame and this
  // component never reads them, so subscribing to the whole viewport used to
  // re-render every edge on every pan tick too, not just every zoom tick.
  // With a few hundred edges on screen, that's the difference between a
  // handful of re-renders across a whole zoom gesture and one per edge per
  // frame for the entire pan.
  const zoom = useStore(zoomSelector);
  const zoomCompensation = 1 / Math.max(zoom, 0.01);
  const strokeWidth = (selected ? 2.5 : isHighlighted ? 2 : 1.5) * zoomCompensation;
  const strokeOpacity = selected ? 1 : isHighlighted ? 0.95 : 0.45;

  // Rectangular dashes (dbdiagram style) with clean, well-spaced flow:
  // 8px dash, 10px gap in screen pixels (compensated for zoom)
  const dash = 8 * zoomCompensation;
  const gap = 10 * zoomCompensation;
  const period = -(dash + gap);
  const flowAnimation = isHighlighted ? `ref-edge-flow ${selected ? 0.6 : 0.9}s linear infinite` : "none";
  const strokeDasharray = `${dash} ${gap}`;

  const baseStrokeStyle = {
    stroke: strokeColor,
    strokeWidth: (isHighlighted ? 1.5 : 1.5) * zoomCompensation,
    opacity: isHighlighted ? 0.3 : strokeOpacity,
    strokeLinecap: "round" as const,
  };

  const animatedStrokeStyle = {
    stroke: strokeColor,
    strokeWidth,
    opacity: strokeOpacity,
    strokeDasharray,
    strokeLinecap: "butt" as const,
    animation: flowAnimation,
    ["--dash-period" as string]: `${period}px`,
  };

  // Show editing controls when the edge is selected, or when hovering the edge
  const showEditingControls = Boolean(selected || isHovered);
  const [sourceCardinality, targetCardinality] = ENDPOINT_CARDINALITY[data?.cardinality ?? "one-to-many"];

  return (
    <>
      {isManyToMany && split ? (
        // Split in two so each half animates on its own; both halves still run
        // source → target, which is what keeps the dash flow and the arrowhead
        // pointing the same way as every other cardinality.
        <>
          <path
            d={polylinePath(split.first)}
            fill="none"
            style={baseStrokeStyle}
            onMouseEnter={() => setIsHovered(true)}
          />
          <path
            d={polylinePath(split.second)}
            fill="none"
            style={baseStrokeStyle}
            onMouseEnter={() => setIsHovered(true)}
          />
          {isHighlighted && (
            <>
              <path
                d={polylinePath(split.first)}
                fill="none"
                className="ref-edge-flow-path"
                style={animatedStrokeStyle}
                onMouseEnter={() => setIsHovered(true)}
              />
              <path
                d={polylinePath(split.second)}
                fill="none"
                className="ref-edge-flow-path"
                style={animatedStrokeStyle}
                onMouseEnter={() => setIsHovered(true)}
              />
            </>
          )}
        </>
      ) : (
        <>
          <path d={routing.fullPath} fill="none" style={baseStrokeStyle} onMouseEnter={() => setIsHovered(true)} />
          {isHighlighted && (
            <path
              d={routing.fullPath}
              fill="none"
              className="ref-edge-flow-path"
              style={animatedStrokeStyle}
              onMouseEnter={() => setIsHovered(true)}
            />
          )}
        </>
      )}
      <EdgeArrowhead
        points={routing.drawnPoints}
        color={strokeColor}
        opacity={strokeOpacity}
        scale={zoomCompensation}
      />
      {/* Generous invisible fat stroke (24px) carrying all pointer & hover interactions.
          No `cursor: pointer` here on purpose: at 24px wide, this hit area crosses large
          swaths of empty-looking canvas on any schema with more than a handful of refs —
          the cursor would flip to "clickable" constantly while just moving the mouse
          around, with nothing to click there most of the time (a waypoint insert is an
          edit-mode edge case, not the default expectation). Hover/select still work
          exactly as before; only the misleading cursor swap is gone. */}
      <path
        d={routing.fullPath}
        fill="none"
        stroke="rgba(0, 0, 0, 0.001)"
        strokeWidth={24 * zoomCompensation}
        strokeLinecap="round"
        className="react-flow__edge-interaction"
        style={{ pointerEvents: "stroke" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          routing.handlePathMouseLeave();
        }}
        onMouseMove={routing.handlePathMouseMove}
        onClick={(e) => {
          if (routing.candidatePoint) {
            e.stopPropagation();
            routing.insertPointAt(routing.candidatePoint);
          } else {
            data?.onSelectEdge?.(id);
          }
        }}
        onDoubleClick={routing.handlePathDoubleClick}
        onContextMenu={(event) => routing.openContextMenu(event)}
      />
      {/* Mounted only when it would hold something: an idle relation used to
          keep a portal (and, with React Flow's own `EdgeLabelRenderer`, a
          store subscription) alive for an empty subtree, several hundred
          times over on a large schema. */}
      {(isHighlighted || showEditingControls || routing.contextMenu) && (
        <EdgeLabelPortal>
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
              source={{ x: sourceX, y: sourceY }}
              target={{ x: targetX, y: targetY }}
              selectedIndex={routing.selectedPointIndex}
              candidatePoint={routing.candidatePoint}
              strokeColor={strokeColor}
              zoom={zoom}
              onStartDrag={routing.startDrag}
              onSelect={routing.setSelectedPointIndex}
              onContextMenu={routing.openContextMenu}
              onInsertCandidate={routing.insertPointAt}
            />
          )}
          {showEditingControls && data && (
            <CardinalityBadge
              x={labelX}
              y={labelY}
              label={style.label}
              cardinality={data.cardinality}
              onCardinalityChange={data.onCardinalityChange}
              onReverseDirection={data.onReverseDirection}
              color={strokeColor}
              zoom={zoom}
              palette={data.palette}
              onPaletteChange={data.onPaletteChange}
              onColorChange={data.onColorChange}
              showReset={routing.hasCustomRouting || routing.points.length !== routing.defaultCorners.length}
              onReset={routing.resetRouting}
              onDeleteRef={data.onDeleteRef}
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
              onReverseDirection={data?.onReverseDirection}
              onDeleteRef={data?.onDeleteRef}
            />
          )}
        </EdgeLabelPortal>
      )}
    </>
  );
}

/**
 * A schema can have a few hundred of these on screen. Plain `memo()` doesn't
 * actually help here: `useCanvasEdges` takes the *whole* `nodes` array as a
 * dependency (it needs each endpoint's position/size/selection for the
 * edge's geometry and highlight state) and rebuilds every ref's `data`
 * object from scratch whenever that array changes reference — which is
 * whenever *any* node is dragged, (de)selected, or hovered, not just this
 * edge's own endpoints. A fresh `data` object every time defeats a plain
 * shallow-prop `memo` exactly the way a fresh `data` object defeated
 * `TableNode`'s (see that file's comparator) — so every edge re-rendered on
 * every unrelated selection/hover/drag, the same "N things re-render for a
 * change to 1" pattern behind the "select all"/"toggle cardinality
 * links"/zoom freezes measured at 100-500 tables.
 *
 * This comparator looks past `data`'s identity to the fields that actually
 * drive this component's output — geometry props by value (cheap
 * primitives), and `data`'s own fields individually. Every callback
 * (`onColorChange`, `onDeleteRef`, ...) is deliberately *not* compared: each
 * is a fresh closure every rebuild by construction, but a pure function of
 * this ref's id/`doc`, which don't change without something else here also
 * changing.
 */
function refEdgePropsAreEqual(prev: EdgeProps<RefEdgeType>, next: EdgeProps<RefEdgeType>): boolean {
  if (
    prev.id !== next.id ||
    prev.selected !== next.selected ||
    prev.sourceX !== next.sourceX ||
    prev.sourceY !== next.sourceY ||
    prev.targetX !== next.targetX ||
    prev.targetY !== next.targetY ||
    prev.sourcePosition !== next.sourcePosition ||
    prev.targetPosition !== next.targetPosition
  ) {
    return false;
  }
  const a = prev.data;
  const b = next.data;
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.cardinality === b.cardinality &&
    a.sourceSlot === b.sourceSlot &&
    a.targetSlot === b.targetSlot &&
    a.routingPoints === b.routingPoints &&
    a.highlightLinks === b.highlightLinks &&
    a.connectedHighlight === b.connectedHighlight &&
    a.color === b.color &&
    a.palette === b.palette
  );
}

export const RefEdge = memo(RefEdgeImpl, refEdgePropsAreEqual);
