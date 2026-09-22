import { useCallback, useRef } from "react";
import { useReactFlow, type NodeChange } from "@xyflow/react";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";
import { recordDuration } from "@/utils/perfMonitor";
import { publishSelecting } from "./selectionDragState";
import type { CanvasNode } from "@/types/index";

/** Below this many screen pixels of movement, a pointerdown-then-up on the pane is a click, not a drag — matches React Flow's own default `paneClickDistance`. */
const DRAG_THRESHOLD_PX = 3;

export interface LassoSelectionHandle {
  /** Attach to the canvas's outer wrapper (not to React Flow's own pane — this replaces its `selectionOnDrag` entirely, see `CanvasArea.tsx`). */
  onPointerDown: (event: React.PointerEvent) => void;
  /** Attach to the rectangle overlay div this hook paints outside React. */
  rectRef: React.RefObject<HTMLDivElement | null>;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Replaces React Flow's built-in `selectionOnDrag` rubber-band select.
 *
 * Measured on a real project (96 tables, "full" detail — see the session's
 * perf HUD capture): React Flow's own mechanism committed its rectangle's
 * position to its internal store, and therefore re-rendered, on *every*
 * native `pointermove` — 111 commits over one 1.8s drag, ~555ms of that
 * gesture in React commit time alone (`canvas.render.update`), on top of a
 * similar amount in `longtask`. Only 6 of those commits corresponded to the
 * selected *set* actually changing — matching this app's own
 * `canvas.onNodesChange` count for the same gesture, which was already
 * negligible.
 *
 * This hook keeps that same shape deliberately: the rectangle's on-screen
 * position updates by mutating a plain DOM node directly (`rectRef`, no
 * React state, so moving the mouse never touches React at all), and
 * `onNodesChange` — the one thing that *does* reach React state — fires only
 * when the actual selected-id set changes, diffed once per animation frame
 * rather than once per pointermove. The hit-test itself is a plain O(tables)
 * scan: at the table counts this canvas reaches (hundreds, not tens of
 * thousands) that's sub-millisecond even at 60 times a second — a spatial
 * index would optimize a cost that was never the one measured here.
 *
 * Each gesture gets its own `pointermove`/`pointerup` closures, created and
 * torn down inside `onPointerDown` — simpler than keeping a stable
 * cross-render identity for them (there is nothing to keep stable *between*
 * gestures; only within one).
 */
export function useLassoSelection(
  nodes: CanvasNode[],
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void,
): LassoSelectionHandle {
  const { screenToFlowPosition } = useReactFlow();
  const rectRef = useRef<HTMLDivElement>(null);
  // Read fresh from inside the gesture's closures without making them (and
  // the listeners they're bound into) depend on `nodes`.
  const nodesRef = useRef(nodes);
  // eslint-disable-next-line react-hooks/refs -- idempotent render-phase write, only ever read from inside a later event/rAF callback, never during this render
  nodesRef.current = nodes;

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return; // left only — middle/right stay reserved for panning
      const target = event.target as HTMLElement;
      if (
        target.closest(
          ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap",
        )
      ) {
        return; // a lasso only starts from an empty pane, same as React Flow's own selectionOnDrag
      }

      const startX = event.clientX;
      const startY = event.clientY;
      let lastX = startX;
      let lastY = startY;
      let dragging = false; // past DRAG_THRESHOLD_PX — an actual lasso, not just a click that hasn't lifted yet
      let rafId: number | null = null;
      let selected = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));

      const paintRect = () => {
        const el = rectRef.current;
        if (!el) return;
        el.style.display = "block";
        el.style.left = `${Math.min(startX, lastX)}px`;
        el.style.top = `${Math.min(startY, lastY)}px`;
        el.style.width = `${Math.abs(lastX - startX)}px`;
        el.style.height = `${Math.abs(lastY - startY)}px`;
      };

      /** One frame's worth of work: repaint the rectangle, re-run the hit-test, commit only if the selected set actually changed. */
      const runFrame = () => {
        rafId = null;
        paintRect();

        const p0 = screenToFlowPosition({ x: startX, y: startY });
        const p1 = screenToFlowPosition({ x: lastX, y: lastY });
        const minX = Math.min(p0.x, p1.x);
        const maxX = Math.max(p0.x, p1.x);
        const minY = Math.min(p0.y, p1.y);
        const maxY = Math.max(p0.y, p1.y);

        // Partial overlap, like React Flow's own default
        // `SelectionMode.Partial` (a table only half inside the box still counts).
        const nextSelected = new Set<string>();
        for (const node of nodesRef.current) {
          const width =
            node.measured?.width ?? (node.type === "sticky" ? node.width : undefined) ?? DEFAULT_TABLE_WIDTH;
          const height =
            node.measured?.height ?? (node.type === "sticky" ? node.height : undefined) ?? DEFAULT_TABLE_HEIGHT;
          const x0 = node.position.x;
          const y0 = node.position.y;
          const x1 = x0 + width;
          const y1 = y0 + height;
          if (x0 < maxX && x1 > minX && y0 < maxY && y1 > minY) nextSelected.add(node.id);
        }

        if (setsEqual(nextSelected, selected)) return;
        const changes: NodeChange<CanvasNode>[] = [];
        for (const node of nodesRef.current) {
          const shouldBeSelected = nextSelected.has(node.id);
          if (Boolean(node.selected) !== shouldBeSelected) {
            changes.push({ id: node.id, type: "select", selected: shouldBeSelected });
          }
        }
        if (changes.length > 0) onNodesChange(changes);
        selected = nextSelected;
      };

      let dragStartedAt = 0;

      const onPointerMove = (moveEvent: PointerEvent) => {
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (!dragging) {
          if (Math.hypot(lastX - startX, lastY - startY) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          dragStartedAt = performance.now();
          // See `selectionDragState.ts`: lets `useCanvasEdges` skip redoing
          // edge geometry for the duration of the drag — table positions
          // don't change from selecting them.
          publishSelecting(true);
        }
        if (rafId == null) rafId = requestAnimationFrame(runFrame);
      };

      const endDrag = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", endDrag);
        if (rafId != null) cancelAnimationFrame(rafId);
        if (dragging) {
          runFrame(); // one final synchronous pass so mouse-up's exact position is never a frame stale
          publishSelecting(false);
          recordDuration("canvas.selectionDragTotal", performance.now() - dragStartedAt);
        }
        const el = rectRef.current;
        if (el) el.style.display = "none";
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [onNodesChange, screenToFlowPosition],
  );

  return { onPointerDown, rectRef };
}
