import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";
import { recordDuration } from "@/utils/perfMonitor";
import { publishSelecting } from "./selectionDragState.svelte";
import type { CanvasNode } from "@/types/index";

/** Below this many screen pixels of movement, a pointerdown-then-up on the pane is a click, not a drag — matches the flow's own default click distance. */
const DRAG_THRESHOLD_PX = 3;

/**
 * A drag that starts and ends on the empty pane still ends in a `click` on it,
 * and a pane click means "deselect everything" (plus the canvas's own pane
 * click: clear the column selection, drop an armed insert tool). The flow's
 * built-in selection box suppresses that click itself; this one has to as
 * well, or every lasso released over empty canvas would select and then
 * immediately clear its selection.
 */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  // The click (if any) is dispatched in the same task as the pointerup that
  // ended the drag; anything later is a genuinely new click.
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * The rubber-band select, in place of the flow's own `selectionOnDrag`.
 *
 * The rectangle's on-screen position updates by mutating a plain DOM node
 * directly (`rect()`, no reactive state, so moving the mouse never touches the
 * component tree at all), and the selection — the one thing that *does* reach
 * reactive state — is only written when the actual selected-id set changes,
 * diffed once per animation frame rather than once per pointermove. It also
 * only ever selects nodes: the flow's built-in box selects every edge touching
 * a selected node too, which would put each of them into edit mode (waypoints,
 * midpoint toolbar) the moment the box swept over its table.
 *
 * The hit-test itself is a plain O(nodes) scan: at the table counts this
 * canvas reaches (hundreds, not tens of thousands) that's sub-millisecond even
 * at 60 times a second.
 */
export function createLassoSelection(options: {
  nodes: () => CanvasNode[];
  screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number };
  select: (isSelected: (node: CanvasNode) => boolean) => void;
  rect: () => HTMLDivElement | undefined;
}) {
  return function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return; // left only — middle/right stay reserved for panning
    const target = event.target as HTMLElement;
    if (
      target.closest(
        ".svelte-flow__node, .svelte-flow__edge, .svelte-flow__handle, .svelte-flow__controls, .svelte-flow__minimap, .nopan",
      )
    ) {
      // A lasso only starts from an empty pane, same as the flow's own
      // selection box — never from a panel, a waypoint dot or the midpoint
      // toolbar (all `.nopan`), whose own drags would otherwise sweep a
      // selection box along with them.
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let dragging = false; // past DRAG_THRESHOLD_PX — an actual lasso, not just a click that hasn't lifted yet
    let rafId: number | null = null;
    let selected = new Set(
      options
        .nodes()
        .filter((n) => n.selected)
        .map((n) => n.id),
    );

    const paintRect = () => {
      const el = options.rect();
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

      const p0 = options.screenToFlowPosition({ x: startX, y: startY });
      const p1 = options.screenToFlowPosition({ x: lastX, y: lastY });
      const minX = Math.min(p0.x, p1.x);
      const maxX = Math.max(p0.x, p1.x);
      const minY = Math.min(p0.y, p1.y);
      const maxY = Math.max(p0.y, p1.y);

      // Partial overlap (a table only half inside the box still counts).
      const nextSelected = new Set<string>();
      for (const node of options.nodes()) {
        const width = node.measured?.width ?? (node.type === "sticky" ? node.width : undefined) ?? DEFAULT_TABLE_WIDTH;
        const height =
          node.measured?.height ?? (node.type === "sticky" ? node.height : undefined) ?? DEFAULT_TABLE_HEIGHT;
        const x0 = node.position.x;
        const y0 = node.position.y;
        const x1 = x0 + width;
        const y1 = y0 + height;
        if (x0 < maxX && x1 > minX && y0 < maxY && y1 > minY) nextSelected.add(node.id);
      }

      if (setsEqual(nextSelected, selected)) return;
      options.select((node) => nextSelected.has(node.id));
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
        // Lets the edge layer skip redoing geometry for the duration of the
        // drag — table positions don't change from selecting them.
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
        swallowNextClick();
      }
      const el = options.rect();
      if (el) el.style.display = "none";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };
}
