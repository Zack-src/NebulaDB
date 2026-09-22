import { useSyncExternalStore } from "react";

/**
 * Whether a selection-box drag (React Flow's `selectionOnDrag`, see
 * `CanvasArea`'s `onSelectionStart`/`onSelectionEnd`) is currently in
 * progress.
 *
 * Dragging a selection box over N tables replaces the `nodes` array on every
 * pointer-move tick as tables enter/leave the box — but none of those
 * tables' *positions* changed, only which ones are selected. `useCanvasEdges`
 * splits edge-building into a geometry half (handle sides, from live table
 * positions/sizes — genuinely expensive: `pickHandleSides` plus six new
 * per-edge closures) and a highlight half (cheap: which ref, if any, reads
 * as connected to a selected/hovered table right now). The highlight half
 * stays live off the raw `nodes` array — relations still highlight in real
 * time as the box crosses each table. This flag only gates the geometry
 * half, so it doesn't redo genuinely-unchanged position/size work on every
 * tick — the same freeze `dragging` already gives it for a position-drag,
 * applied to a selection-drag for the same reason (nothing moved), not to
 * defer anything the user would see change.
 */

let selecting = false;
const listeners = new Set<() => void>();

export function publishSelecting(next: boolean): void {
  if (selecting === next) return;
  selecting = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return selecting;
}

/** True for the duration of a selection-box drag. */
export function useIsSelecting(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
