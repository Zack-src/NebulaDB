/**
 * Whether a selection-box drag (the lasso, see `lassoSelection.ts`) is
 * currently in progress.
 *
 * Dragging a selection box over N tables replaces the `nodes` array on every
 * frame as tables enter/leave the box — but none of those tables' *positions*
 * changed, only which ones are selected. The edge layer (`canvasEdges`) splits
 * its build into a geometry half (handle sides, from live table
 * positions/sizes — genuinely expensive) and a highlight half (cheap: which
 * ref, if any, reads as connected to a selected/hovered table right now). The
 * highlight half stays live — relations still highlight in real time as the
 * box crosses each table. This flag only gates the geometry half, so it
 * doesn't redo genuinely-unchanged position/size work on every frame — the
 * same freeze `dragging` already gives it for a position-drag.
 */
class SelectionDragState {
  selecting = $state(false);
}

export const selectionDrag = new SelectionDragState();

export function publishSelecting(next: boolean): void {
  if (selectionDrag.selecting !== next) selectionDrag.selecting = next;
}
