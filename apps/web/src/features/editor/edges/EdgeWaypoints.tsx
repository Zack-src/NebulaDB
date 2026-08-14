import type { MouseEvent as ReactMouseEvent } from "react";
import type { Point } from "@/features/editor/edges/pathMath";
import { EDGE_CHROME_Z } from "@/features/editor/edges/canvasLayers";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * Draggable dots on each of a ref's custom/default corner points.
 *
 * Counter-scaled against zoom for the same reason as the midpoint toolbar: the
 * dots live inside React Flow's viewport transform, and a 10px grab handle at
 * 30% zoom is a 3px target nobody can hit.
 */
export function EdgeWaypoints(props: {
  points: Point[];
  selectedIndex: number | null;
  strokeColor: string;
  zoom: number;
  onStartDrag: (index: number, e: ReactMouseEvent) => void;
  onSelect: (index: number) => void;
  onContextMenu: (e: ReactMouseEvent, index: number) => void;
}) {
  const { t } = useTranslation();
  const scale = 1 / Math.max(props.zoom, 0.01);

  return (
    <>
      {props.points.map((p, i) => (
        <div
          key={i}
          // React Flow paints the node layer after the edge-label layer and
          // gives a selected/dragged node z-index 1000, so a waypoint landing
          // near or under a table would otherwise be un-clickable — exactly
          // where routing one to steer *around* that table is most needed. The
          // old `z-10` cleared idle nodes only.
          className={`ref-edge-waypoint pointer-events-auto absolute h-2.5 w-2.5 cursor-grab rounded-full border-2 bg-surface shadow-xs active:cursor-grabbing nodrag nopan${i === props.selectedIndex ? " shadow-[0_0_0_2px_var(--color-primary)]" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${scale})`,
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
      ))}
    </>
  );
}
