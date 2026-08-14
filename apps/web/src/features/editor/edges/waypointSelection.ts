/**
 * Which edge waypoint, if any, currently owns the Delete key.
 *
 * Waypoint selection is local state inside each `useEdgeRouting`, but the
 * canvas-wide Delete handler has to know about it: pressing Delete with a
 * corner selected must remove that corner, not the whole relation. Kept as a
 * module singleton rather than context because there is only ever one selected
 * waypoint in the app, it is written and read from event handlers (never during
 * render), and no component needs to re-render when it changes.
 */

export interface WaypointSelection {
  edgeId: string;
  index: number;
}

let current: WaypointSelection | null = null;

export function getSelectedWaypoint(): WaypointSelection | null {
  return current;
}

export function setSelectedWaypoint(selection: WaypointSelection): void {
  current = selection;
}

/** Clears the selection, but only if it still belongs to `edgeId` — another edge may have claimed it since. */
export function clearSelectedWaypoint(edgeId: string): void {
  if (current?.edgeId === edgeId) current = null;
}
