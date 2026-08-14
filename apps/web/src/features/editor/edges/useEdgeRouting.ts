import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getSmoothStepPath, useReactFlow, type Position } from "@xyflow/react";
import type { RoutingPoint } from "@athanordb/shared";
import {
  closestPointOnSegment,
  closestSegmentIndex,
  getDefaultCornerPoints,
  orthogonalPolylinePoints,
  polylinePath,
  simplifyRoutingPoints,
  type Point,
} from "@/features/editor/edges/pathMath";
import { clearSelectedWaypoint, setSelectedWaypoint } from "@/features/editor/edges/waypointSelection";
import { isTypingTarget } from "@/utils/dom";

export interface EdgeContextMenuState {
  x: number;
  y: number;
  pointIndex?: number;
  /** Flow-space position the menu was opened at — where "insert a point here" lands it. */
  flowPosition: Point;
}

/** Marks the menu's own DOM subtree so the capture-phase dismiss can tell a click inside it from one outside. */
export const EDGE_MENU_ATTRIBUTE = "data-edge-context-menu";

/**
 * Owns everything about a ref edge's routing: the default (auto) corner
 * points derived from React Flow's own smoothstep path, any user-dragged
 * custom waypoints layered on top, drag-in-progress state, which waypoint
 * is selected, and the right-click context menu — all bundled together
 * because committing/resetting routing needs to clear selection and close
 * the menu in lockstep.
 */
export function useEdgeRouting(params: {
  edgeId: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  routingPoints?: RoutingPoint[];
  onRoutingPointsChange: (points: RoutingPoint[] | undefined) => void;
}) {
  const { edgeId, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, routingPoints, onRoutingPointsChange } = params;
  const { screenToFlowPosition } = useReactFlow();

  const [dragPoints, setDragPoints] = useState<RoutingPoint[] | null>(null);
  const dragPointsRef = useRef<RoutingPoint[] | null>(null);
  const draggingIndexRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const [selectedPointIndex, setSelectedPointIndexState] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<EdgeContextMenuState | null>(null);

  const [stepPath, stepLabelX, stepLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 0,
  });

  const defaultCorners = useMemo(() => {
    const raw = getDefaultCornerPoints(stepPath, sourceX, sourceY, targetX, targetY);
    // The auto-computed corners (not something the user dragged) can still
    // include a near-straight jog when source/target are only a few px off
    // axis — same collinearity cleanup as commitPoints, applied here so it
    // also covers waypoints nobody ever touched, not just custom routing.
    return simplifyRoutingPoints(raw, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  }, [stepPath, sourceX, sourceY, targetX, targetY]);

  const hasCustomRouting = Boolean(routingPoints && routingPoints.length > 0);
  const points = dragPoints ?? routingPoints ?? defaultCorners;

  const allPoints: Point[] = useMemo(
    () => [{ x: sourceX, y: sourceY }, ...points, { x: targetX, y: targetY }],
    [sourceX, sourceY, points, targetX, targetY],
  );

  // The corner-for-corner list the stroke actually follows — `allPoints` still
  // holds diagonals that the renderer breaks into dog-legs, so anything keying
  // off the line's real direction (the cardinality chips) needs this one.
  const drawnPoints = useMemo(() => orthogonalPolylinePoints(allPoints), [allPoints]);
  const fullPath = polylinePath(drawnPoints);

  // Endpoints read through a ref rather than a closure, so a commit landing
  // after the user dragged the table itself simplifies against where the table
  // is *now* instead of where it was when the drag started.
  const endpointsRef = useRef({ sourceX, sourceY, targetX, targetY });
  useEffect(() => {
    endpointsRef.current = { sourceX, sourceY, targetX, targetY };
  }, [sourceX, sourceY, targetX, targetY]);

  const commitPoints = (next: RoutingPoint[]) => {
    const ends = endpointsRef.current;
    const simplified = simplifyRoutingPoints(next, { x: ends.sourceX, y: ends.sourceY }, { x: ends.targetX, y: ends.targetY });
    onRoutingPointsChange(simplified.length > 0 ? simplified : undefined);
  };

  const setSelectedPointIndex = (index: number | null) => {
    setSelectedPointIndexState(index);
    if (index === null) clearSelectedWaypoint(edgeId);
    else setSelectedWaypoint({ edgeId, index });
  };

  const closeContextMenu = () => setContextMenu(null);

  const resetRouting = () => {
    onRoutingPointsChange(undefined);
    setDragPoints(null);
    dragPointsRef.current = null;
    setSelectedPointIndex(null);
    setContextMenu(null);
  };

  const deletePointAt = (index: number) => {
    const next = points.filter((_, i) => i !== index);
    commitPoints(next);
    setSelectedPointIndex(null);
    setContextMenu(null);
  };

  /**
   * Adds a corner where the user clicked.
   *
   * Both the hit-test and the resulting waypoint list are built from
   * `drawnPoints`, not from the raw waypoints: the line on screen is the
   * orthogonalised version, so measuring the click against the raw diagonal
   * chain picked a different segment than the one under the cursor, and storing
   * the raw click re-ran the dog-leg expansion and moved the corner somewhere
   * else again. Working in the already-expanded chain makes the re-expansion a
   * no-op, so the route keeps its exact shape and only gains the new corner.
   */
  const insertPointAt = (flowPos: Point) => {
    const drawn = drawnPoints;
    if (drawn.length < 2) return;
    const segment = closestSegmentIndex(drawn, flowPos);
    const projected = closestPointOnSegment(flowPos, drawn[segment], drawn[segment + 1]);
    const interior = drawn.slice(1, drawn.length - 1);
    const next = [...interior.slice(0, segment), projected, ...interior.slice(segment)];
    commitPoints(next);
    setContextMenu(null);
  };

  const handlePathDoubleClick = (event: ReactMouseEvent) => {
    event.stopPropagation();
    insertPointAt(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  // dbdiagram-style: dragging a point carries the segment to the *next*
  // point along with it (both translate together, rigidly), so only the
  // joint with the *previous* point re-kinks. Dragging each point
  // independently — the old behaviour — tended to open a kink on both
  // sides at once, which is what produced the tangled overlapping lines
  // this was built to fix.
  const startDrag = (index: number, e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingIndexRef.current = index;
    movedRef.current = false;
    const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const initialPoints = points;
    const setDrag = (next: RoutingPoint[] | null) => {
      dragPointsRef.current = next;
      setDragPoints(next);
    };
    setDrag(initialPoints);
    setSelectedPointIndex(index);

    const onMove = (ev: MouseEvent) => {
      movedRef.current = true;
      const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = flowPos.x - startFlow.x;
      const dy = flowPos.y - startFlow.y;
      const next = [...initialPoints];
      next[index] = { x: initialPoints[index].x + dx, y: initialPoints[index].y + dy };
      if (index + 1 < initialPoints.length) {
        next[index + 1] = { x: initialPoints[index + 1].x + dx, y: initialPoints[index + 1].y + dy };
      }
      setDrag(next);
    };
    // The commit happens here rather than inside a `setDragPoints` updater:
    // state updaters must be pure, and React deliberately runs them twice in
    // StrictMode — which wrote every waypoint drag to the shared Yjs document
    // twice, once per invocation.
    const onUp = () => {
      const finalPoints = dragPointsRef.current;
      setDrag(null);
      draggingIndexRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (finalPoints && movedRef.current) commitPoints(finalPoints);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const openContextMenu = (event: ReactMouseEvent, pointIndex?: number) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      pointIndex,
      flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  };

  // Capture phase, because the menu is portaled to document.body and stops
  // propagation on its own clicks — a bubble-phase listener on `window` sat
  // below the portal in the path and simply never ran. `contextmenu` is here
  // too: right-clicking a second edge emits no `click`, so two menus used to
  // end up open at once.
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(`[${EDGE_MENU_ATTRIBUTE}]`)) return;
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", close, true);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close, true);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (selectedPointIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      deletePointAt(selectedPointIndex);
    };
    const onClickOutside = (event: MouseEvent) => {
      if ((event.target as HTMLElement)?.closest?.(".ref-edge-waypoint")) return;
      setSelectedPointIndex(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClickOutside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPointIndex, points]);

  // Leaving the canvas (or deselecting the edge) must hand the Delete key back
  // to the node/edge deletion handler.
  useEffect(() => () => clearSelectedWaypoint(edgeId), [edgeId]);

  return {
    points,
    allPoints,
    drawnPoints,
    fullPath,
    stepLabelX,
    stepLabelY,
    defaultCorners,
    hasCustomRouting,
    selectedPointIndex,
    setSelectedPointIndex,
    contextMenu,
    openContextMenu,
    closeContextMenu,
    resetRouting,
    deletePointAt,
    insertPointAt,
    handlePathDoubleClick,
    startDrag,
  };
}
