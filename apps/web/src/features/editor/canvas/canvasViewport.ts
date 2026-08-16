import { useCallback, useState } from "react";
import { PanOnScrollMode, useReactFlow, type MiniMapProps, type OnMoveEnd } from "@xyflow/react";
import { loadShowMinimap, loadViewport, saveShowMinimap, saveViewport } from "@/utils/preferences";

/** How long a minimap click's animated pan takes. */
const MINIMAP_PAN_DURATION_MS = 350;

/**
 * Zoom floor shared by the MLD and MCD canvases — low enough to see a large
 * schema fully zoomed out. Kept in exactly one place on purpose: the two
 * canvases share a single stored viewport (see `useSharedViewport`), and a
 * stricter floor on one side would clamp that shared value up the moment it
 * mounts, silently overwriting what the other side had saved.
 */
export const CANVAS_MIN_ZOOM = 0.05;

/** React Flow viewport-behavior props common to both canvases — spread onto `<ReactFlow>` rather than repeated. */
export const CANVAS_VIEWPORT_PROPS = {
  panOnScroll: true,
  panOnScrollMode: PanOnScrollMode.Free,
  zoomOnScroll: false,
  zoomActivationKeyCode: "Control",
  minZoom: CANVAS_MIN_ZOOM,
} as const;

/**
 * The per-project, per-user pan/zoom, persisted across both canvases under
 * the same key — switching MLD/MCD lands on the same spot instead of each
 * view keeping (and drifting from) its own.
 */
export function useSharedViewport(projectId: string, viewportUserId: string) {
  // Lazy initializer: read once at mount, not on every render — this decides
  // whether the very first render asks React Flow to `fitView` or restores
  // exactly where this user left the canvas last time.
  const [initialViewport] = useState(() => loadViewport(projectId, viewportUserId));
  const onMoveEnd: OnMoveEnd = useCallback(
    (_event, viewport) => saveViewport(projectId, viewportUserId, viewport),
    [projectId, viewportUserId],
  );
  return { initialViewport, onMoveEnd };
}

/**
 * Minimap props common to both canvases: a smooth animated pan-to-click
 * instead of React Flow's default (`pannable`) instant jump, plus the mask
 * colour matching the app's dark theme instead of React Flow's default
 * near-white overlay. `pannable` is deliberately left off — it drives the
 * viewport straight from its own d3-drag handler with no duration, and
 * there's no prop to make *that* animate; a plain `onClick` is the only hook
 * the component exposes, so this replaces drag-to-pan with click-to-pan
 * entirely rather than fighting the built-in jump underneath it.
 */
export function useMinimapPanProps(): Pick<MiniMapProps, "zoomable" | "onClick" | "maskColor" | "bgColor"> {
  const { setCenter, getZoom } = useReactFlow();
  const onClick = useCallback<NonNullable<MiniMapProps["onClick"]>>(
    (_event, position) => {
      setCenter(position.x, position.y, { zoom: getZoom(), duration: MINIMAP_PAN_DURATION_MS });
    },
    [setCenter, getZoom],
  );
  return { zoomable: true, onClick, maskColor: "var(--color-overlay)", bgColor: "var(--color-surface)" };
}

/**
 * The minimap's show/hide preference, shared by both canvases under the
 * same storage key — toggling it in one view carries over to the other
 * instead of each keeping its own.
 */
export function useSharedMinimapVisible() {
  const [visible, setVisible] = useState(loadShowMinimap);
  const toggle = useCallback(() => {
    setVisible((current) => {
      saveShowMinimap(!current);
      return !current;
    });
  }, []);
  return { visible, toggle };
}
