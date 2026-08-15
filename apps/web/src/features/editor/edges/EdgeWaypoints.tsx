import type { MouseEvent as ReactMouseEvent } from "react";
import { PlusIcon } from "@/components/icons/Icons";
import { getWaypointOrientation, type Point } from "@/features/editor/edges/pathMath";
import { EDGE_CHROME_Z } from "@/features/editor/edges/canvasLayers";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * Draggable dots on each of a ref's custom/default corner points,
 * plus a ghost candidate insertion point when hovering along the segment.
 */
export function EdgeWaypoints(props: {
  points: Point[];
  source: Point;
  target: Point;
  selectedIndex: number | null;
  strokeColor: string;
  zoom: number;
  candidatePoint?: Point | null;
  onStartDrag: (index: number, e: ReactMouseEvent) => void;
  onSelect: (index: number) => void;
  onContextMenu: (e: ReactMouseEvent, index: number) => void;
  onInsertCandidate?: (p: Point) => void;
}) {
  const { t } = useTranslation();
  const scale = 1 / Math.max(props.zoom, 0.01);

  return (
    <>
      {/* Existing Waypoint Drag Handles */}
      {props.points.map((p, i) => {
        const orientation = getWaypointOrientation(i, props.points, props.source, props.target);
        const cursorClass =
          orientation === "ew-resize"
            ? "cursor-ew-resize"
            : orientation === "ns-resize"
              ? "cursor-ns-resize"
              : "cursor-move";

        return (
          <div
            key={i}
            className={`ref-edge-waypoint pointer-events-auto absolute h-3 w-3 rounded-full border-2 bg-surface shadow-xs active:scale-125 nodrag nopan ${cursorClass}${
              i === props.selectedIndex ? " ring-2 ring-primary ring-offset-1 ring-offset-bg" : ""
            }`}
            style={{
              left: 0,
              top: 0,
              transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${scale})`,
              transformOrigin: "center center",
              borderColor: props.strokeColor,
              zIndex: EDGE_CHROME_Z,
            }}
            onMouseDown={(event) => props.onStartDrag(i, event)}
            onClick={(event) => {
              event.stopPropagation();
              props.onSelect(i);
            }}
            onContextMenu={(event) => props.onContextMenu(event, i)}
            data-tooltip={t("edge.waypointHint")}
          />
        );
      })}

      {/* Ghost Candidate Point on Hover between points */}
      {props.candidatePoint && props.onInsertCandidate && (
        <div
          className="pointer-events-auto absolute flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-primary bg-primary-light/90 text-primary shadow-md hover:scale-125 nodrag nopan"
          style={{
            left: 0,
            top: 0,
            transform: `translate(${props.candidatePoint.x}px, ${props.candidatePoint.y}px) translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center center",
            zIndex: EDGE_CHROME_Z + 1,
          }}
          onClick={(e) => {
            e.stopPropagation();
            props.onInsertCandidate?.(props.candidatePoint!);
          }}
          data-tooltip={t("edge.addPoint")}
        >
          <PlusIcon size={10} />
        </div>
      )}
    </>
  );
}
