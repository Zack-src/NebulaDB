import { getSmoothStepPath, useSvelteFlow, type Position } from "@xyflow/svelte";
import type { RoutingPoint } from "@athanordb/shared";
import {
  closestPointOnSegment,
  closestSegmentIndex,
  getDefaultCornerPoints,
  getWaypointOrientation,
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

export interface EdgeRoutingParams {
  edgeId: () => string;
  sourceX: () => number;
  sourceY: () => number;
  targetX: () => number;
  targetY: () => number;
  sourcePosition: () => Position;
  targetPosition: () => Position;
  routingPoints: () => RoutingPoint[] | undefined;
  onRoutingPointsChange: (points: RoutingPoint[] | undefined) => void;
}

/**
 * Owns everything about a ref edge's routing: the default (auto) corner
 * points derived from the flow's own smoothstep path, any user-dragged custom
 * waypoints layered on top, drag-in-progress state, which waypoint is
 * selected, and the right-click context menu — all bundled together because
 * committing/resetting routing needs to clear selection and close the menu in
 * lockstep.
 *
 * Must be called during an edge component's initialisation.
 */
export function useEdgeRouting(params: EdgeRoutingParams) {
  const { screenToFlowPosition } = useSvelteFlow();

  let dragPoints = $state.raw<RoutingPoint[] | null>(null);
  let draggingIndex: number | null = null;
  // Reactive twin of `draggingIndex`: it's what keeps `showEditingControls`
  // true in `RefEdge` for the whole drag. Without it, the fat invisible
  // hover-stroke sees `mouseleave` the instant the cursor crosses onto the
  // waypoint dot itself (a portaled, non-descendant element sitting on top of
  // it) — the edge stops counting as hovered mid-drag, `EdgeWaypoints`
  // unmounts, and the very dot being dragged vanishes or reappears somewhere
  // that no longer matches the cursor.
  let isDraggingPoint = $state(false);
  let moved = false;
  let selectedPointIndex = $state<number | null>(null);
  let contextMenu = $state.raw<EdgeContextMenuState | null>(null);
  let candidatePoint = $state.raw<Point | null>(null);

  const step = $derived.by(() => {
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX: params.sourceX(),
      sourceY: params.sourceY(),
      sourcePosition: params.sourcePosition(),
      targetX: params.targetX(),
      targetY: params.targetY(),
      targetPosition: params.targetPosition(),
      borderRadius: 0,
    });
    return { path, labelX, labelY };
  });

  const defaultCorners = $derived.by(() => {
    const sourceX = params.sourceX();
    const sourceY = params.sourceY();
    const targetX = params.targetX();
    const targetY = params.targetY();
    const raw = getDefaultCornerPoints(step.path, sourceX, sourceY, targetX, targetY);
    // The auto-computed corners (not something the user dragged) can still
    // include a near-straight jog when source/target are only a few px off
    // axis — same collinearity cleanup as `commitPoints`, applied here so it
    // also covers waypoints nobody ever touched, not just custom routing.
    return simplifyRoutingPoints(raw, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  });

  const hasCustomRouting = $derived(Boolean(params.routingPoints()?.length));
  const points = $derived(dragPoints ?? params.routingPoints() ?? defaultCorners);

  const allPoints: Point[] = $derived([
    { x: params.sourceX(), y: params.sourceY() },
    ...points,
    { x: params.targetX(), y: params.targetY() },
  ]);

  // The corner-for-corner list the stroke actually follows — `allPoints` still
  // holds diagonals that the renderer breaks into dog-legs, so anything keying
  // off the line's real direction (the cardinality chips) needs this one.
  const drawnPoints = $derived(orthogonalPolylinePoints(allPoints));
  const fullPath = $derived(polylinePath(drawnPoints));

  // Endpoints are read at call time (not captured at drag start), so a commit
  // landing after the user dragged the table itself simplifies against where
  // the table is *now*.
  function commitPoints(next: RoutingPoint[]) {
    const simplified = simplifyRoutingPoints(
      next,
      { x: params.sourceX(), y: params.sourceY() },
      { x: params.targetX(), y: params.targetY() },
    );
    params.onRoutingPointsChange(simplified.length > 0 ? simplified : undefined);
  }

  function setSelectedPointIndex(index: number | null) {
    selectedPointIndex = index;
    if (index === null) clearSelectedWaypoint(params.edgeId());
    else setSelectedWaypoint({ edgeId: params.edgeId(), index });
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function resetRouting() {
    params.onRoutingPointsChange(undefined);
    dragPoints = null;
    setSelectedPointIndex(null);
    contextMenu = null;
  }

  function deletePointAt(index: number) {
    commitPoints(points.filter((_, i) => i !== index));
    setSelectedPointIndex(null);
    contextMenu = null;
  }

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
  function insertPointAt(flowPos: Point) {
    const drawn = drawnPoints;
    if (drawn.length < 2) return;
    const segment = closestSegmentIndex(drawn, flowPos);
    const projected = closestPointOnSegment(flowPos, drawn[segment], drawn[segment + 1]);
    const interior = drawn.slice(1, drawn.length - 1);
    commitPoints([...interior.slice(0, segment), projected, ...interior.slice(segment)]);
    candidatePoint = null;
    contextMenu = null;
  }

  function handlePathMouseMove(event: MouseEvent) {
    const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const drawn = drawnPoints;
    if (drawn.length < 2) return;
    const segment = closestSegmentIndex(drawn, flowPos);
    const projected = closestPointOnSegment(flowPos, drawn[segment], drawn[segment + 1]);
    const isNearExisting = allPoints.some((pt) => Math.hypot(pt.x - projected.x, pt.y - projected.y) < 18);
    candidatePoint = isNearExisting ? null : projected;
  }

  function handlePathMouseLeave() {
    candidatePoint = null;
  }

  function handlePathDoubleClick(event: MouseEvent) {
    event.stopPropagation();
    insertPointAt(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }

  function startDrag(index: number, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    draggingIndex = index;
    isDraggingPoint = true;
    moved = false;
    const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const initialPoints = points.map((p) => ({ ...p }));
    const source = { x: params.sourceX(), y: params.sourceY() };
    const target = { x: params.targetX(), y: params.targetY() };
    setSelectedPointIndex(index);

    const onMove = (ev: MouseEvent) => {
      const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = flowPos.x - startFlow.x;
      const dy = flowPos.y - startFlow.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;

      // Recomputed from the point's *current* dragged position on every move
      // rather than once at grab time: fixing it at grab meant a point
      // sitting near-diagonal to its neighbors could be misclassified once and
      // then stay locked to the wrong single axis for the whole drag.
      const livePoints = dragPoints ?? initialPoints;
      const orientation = getWaypointOrientation(index, livePoints, source, target);

      const all = [source, ...initialPoints, target];
      const prev = all[index];
      const curr = all[index + 1];
      const nextPt = all[index + 2];

      const nextPoints = initialPoints.map((p) => ({ ...p }));

      if (orientation === "ew-resize") {
        const newX = curr.x + dx;
        nextPoints[index].x = newX;
        // If the segment between curr and nextPt is vertical (same X), move nextPt.x as well
        if (nextPt && Math.abs(curr.x - nextPt.x) <= Math.abs(curr.y - nextPt.y) && index + 1 < nextPoints.length) {
          nextPoints[index + 1].x = newX;
        }
        // If the segment between prev and curr is vertical (same X), move prev.x as well
        if (prev && Math.abs(prev.x - curr.x) <= Math.abs(prev.y - curr.y) && index - 1 >= 0) {
          nextPoints[index - 1].x = newX;
        }
      } else if (orientation === "ns-resize") {
        const newY = curr.y + dy;
        nextPoints[index].y = newY;
        // If the segment between curr and nextPt is horizontal (same Y), move nextPt.y as well
        if (nextPt && Math.abs(curr.y - nextPt.y) <= Math.abs(curr.x - nextPt.x) && index + 1 < nextPoints.length) {
          nextPoints[index + 1].y = newY;
        }
        // If the segment between prev and curr is horizontal (same Y), move prev.y as well
        if (prev && Math.abs(prev.y - curr.y) <= Math.abs(prev.x - curr.x) && index - 1 >= 0) {
          nextPoints[index - 1].y = newY;
        }
      } else {
        nextPoints[index].x = curr.x + dx;
        nextPoints[index].y = curr.y + dy;
      }

      dragPoints = nextPoints;
    };
    const onUp = () => {
      const finalPoints = dragPoints;
      dragPoints = null;
      draggingIndex = null;
      isDraggingPoint = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (finalPoints && moved) commitPoints(finalPoints);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function openContextMenu(event: MouseEvent, pointIndex?: number) {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      pointIndex,
      flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    };
  }

  // Capture phase, because the menu is portaled to document.body and stops
  // propagation on its own clicks — a bubble-phase listener on `window` sat
  // below the portal in the path and simply never ran. `contextmenu` is here
  // too: right-clicking a second edge emits no `click`, so two menus used to
  // end up open at once.
  $effect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(`[${EDGE_MENU_ATTRIBUTE}]`)) return;
      contextMenu = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") contextMenu = null;
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
  });

  $effect(() => {
    const index = selectedPointIndex;
    if (index === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      deletePointAt(index);
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
  });

  // Leaving the canvas (or deselecting the edge) must hand the Delete key back
  // to the node/edge deletion handler.
  $effect(() => {
    const id = params.edgeId();
    return () => clearSelectedWaypoint(id);
  });

  return {
    get points() {
      return points;
    },
    get allPoints() {
      return allPoints;
    },
    get drawnPoints() {
      return drawnPoints;
    },
    get fullPath() {
      return fullPath;
    },
    get stepLabelX() {
      return step.labelX;
    },
    get stepLabelY() {
      return step.labelY;
    },
    get defaultCorners() {
      return defaultCorners;
    },
    get hasCustomRouting() {
      return hasCustomRouting;
    },
    get isDraggingPoint() {
      return isDraggingPoint;
    },
    get selectedPointIndex() {
      return selectedPointIndex;
    },
    setSelectedPointIndex,
    get contextMenu() {
      return contextMenu;
    },
    openContextMenu,
    closeContextMenu,
    resetRouting,
    deletePointAt,
    insertPointAt,
    get candidatePoint() {
      return candidatePoint;
    },
    handlePathMouseMove,
    handlePathMouseLeave,
    handlePathDoubleClick,
    startDrag,
    /** Exposed only so a caller can tell a drag is live without re-deriving it. */
    get draggingIndex() {
      return draggingIndex;
    },
  };
}

export type EdgeRouting = ReturnType<typeof useEdgeRouting>;
