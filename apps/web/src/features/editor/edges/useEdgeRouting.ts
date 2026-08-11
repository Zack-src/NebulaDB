import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getSmoothStepPath, useReactFlow, type Position } from "@xyflow/react";
import type { RoutingPoint } from "@athanordb/shared";
import { closestSegmentIndex, getDefaultCornerPoints, orthogonalPolylinePath, simplifyRoutingPoints, type Point } from "@/features/editor/edges/pathMath";

export interface EdgeContextMenuState {
  x: number;
  y: number;
  pointIndex?: number;
}

/**
 * Owns everything about a ref edge's routing: the default (auto) corner
 * points derived from React Flow's own smoothstep path, any user-dragged
 * custom waypoints layered on top, drag-in-progress state, which waypoint
 * is selected, and the right-click context menu — all bundled together
 * because committing/resetting routing needs to clear selection and close
 * the menu in lockstep.
 */
export function useEdgeRouting(params: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  routingPoints?: RoutingPoint[];
  onRoutingPointsChange: (points: RoutingPoint[] | undefined) => void;
}) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, routingPoints, onRoutingPointsChange } = params;
  const { screenToFlowPosition } = useReactFlow();

  const [dragPoints, setDragPoints] = useState<RoutingPoint[] | null>(null);
  const draggingIndexRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
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

  const fullPath = orthogonalPolylinePath(allPoints);

  const commitPoints = (next: RoutingPoint[]) => {
    const simplified = simplifyRoutingPoints(next, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
    onRoutingPointsChange(simplified.length > 0 ? simplified : undefined);
  };

  const resetRouting = () => {
    onRoutingPointsChange(undefined);
    setDragPoints(null);
    setSelectedPointIndex(null);
    setContextMenu(null);
  };

  const deletePointAt = (index: number) => {
    const next = points.filter((_, i) => i !== index);
    commitPoints(next);
    setSelectedPointIndex(null);
    setContextMenu(null);
  };

  const handlePathDoubleClick = (event: ReactMouseEvent) => {
    event.stopPropagation();
    const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const segIndex = closestSegmentIndex(allPoints, flowPos);
    const next = [...points.slice(0, segIndex), flowPos, ...points.slice(segIndex)];
    commitPoints(next);
  };

  const startDrag = (index: number, e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingIndexRef.current = index;
    movedRef.current = false;
    setDragPoints(points);
    setSelectedPointIndex(index);

    const onMove = (ev: MouseEvent) => {
      movedRef.current = true;
      const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      setDragPoints((prev) => {
        if (!prev || draggingIndexRef.current === null) return prev;
        const next = [...prev];
        next[draggingIndexRef.current] = flowPos;
        return next;
      });
    };
    const onUp = () => {
      setDragPoints((prev) => {
        if (prev && movedRef.current) commitPoints(prev);
        return null;
      });
      draggingIndexRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const openContextMenu = (event: ReactMouseEvent, pointIndex?: number) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, pointIndex });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("wheel", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("wheel", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (selectedPointIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target as HTMLElement | null;
      if (
        !target ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        Boolean(target.closest(".cm-editor, .nokey, [contenteditable='true']"))
      ) {
        return;
      }
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

  return {
    points,
    allPoints,
    fullPath,
    stepLabelX,
    stepLabelY,
    defaultCorners,
    hasCustomRouting,
    selectedPointIndex,
    setSelectedPointIndex,
    contextMenu,
    openContextMenu,
    closeContextMenu: () => setContextMenu(null),
    resetRouting,
    deletePointAt,
    handlePathDoubleClick,
    startDrag,
  };
}
