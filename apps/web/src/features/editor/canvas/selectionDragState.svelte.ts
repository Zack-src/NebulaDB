/**
 * Whether a selection-box drag (the lasso) is in progress. A lasso replaces the `nodes` array
 * every frame without moving anything, so this flag freezes the edge layer's geometry half
 * (`canvasEdges`) like `dragging` does; the highlight half stays live.
 */
class SelectionDragState {
  selecting = $state(false);
}

export const selectionDrag = new SelectionDragState();

export function publishSelecting(next: boolean): void {
  if (selectionDrag.selecting !== next) selectionDrag.selecting = next;
}
