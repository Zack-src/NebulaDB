import { PanOnScrollMode, type OnMoveEnd, type Viewport } from "@xyflow/svelte";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";
import { loadShowMinimap, loadViewport, saveShowMinimap, saveViewport } from "@/utils/preferences";
import type { CanvasNode } from "@/types";

/** Shared by every "jump to a table" gesture — canvas search (Ctrl+F) and the DBML editor's double-click-to-canvas navigation. */
const JUMP_ZOOM = 1;
const JUMP_DURATION_MS = 300;

type SetCenter = (x: number, y: number, options?: { zoom?: number; duration?: number }) => Promise<boolean>;

/**
 * Centers the viewport on `tableId` and selects it — the same selection path a
 * real click goes through, so the target gets the ordinary selection outline
 * instead of a bespoke "found"/"navigated" style. Returns whether a matching
 * node was actually found.
 */
export function jumpToTableNode(
  nodes: CanvasNode[],
  tableId: string,
  setCenter: SetCenter,
  select: (isSelected: (node: CanvasNode) => boolean) => void,
): boolean {
  const node = nodes.find((candidate) => candidate.id === tableId);
  if (!node) return false;
  const width = node.measured?.width ?? DEFAULT_TABLE_WIDTH;
  const height = node.measured?.height ?? DEFAULT_TABLE_HEIGHT;
  void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
    zoom: JUMP_ZOOM,
    duration: JUMP_DURATION_MS,
  });
  select((candidate) => (candidate.type === "table" ? candidate.id === tableId : Boolean(candidate.selected)));
  return true;
}

/** How long a minimap click's animated pan takes. */
export const MINIMAP_PAN_DURATION_MS = 350;

/**
 * Zoom floor shared by the MLD and MCD canvases — low enough to see a large
 * schema fully zoomed out. Kept in exactly one place on purpose: the two
 * canvases share a single stored viewport (see `useSharedViewport`), and a
 * stricter floor on one side would clamp that shared value up the moment it
 * mounts, silently overwriting what the other side had saved.
 */
export const CANVAS_MIN_ZOOM = 0.05;

/** Viewport-behavior props common to both canvases — spread onto `<SvelteFlow>` rather than repeated. */
export const CANVAS_VIEWPORT_PROPS = {
  panOnScroll: true,
  panOnScrollMode: PanOnScrollMode.Free,
  zoomOnScroll: false,
  zoomActivationKey: "Control",
  minZoom: CANVAS_MIN_ZOOM,
} as const;

/**
 * The per-project, per-user pan/zoom, persisted across both canvases under
 * the same key — switching MLD/MCD lands on the same spot instead of each
 * view keeping (and drifting from) its own. Read once, at mount: this decides
 * whether the very first render asks the flow to `fitView` or restores
 * exactly where this user left the canvas last time.
 */
export function useSharedViewport(projectId: string, viewportUserId: string) {
  const initialViewport: Viewport | null = loadViewport(projectId, viewportUserId);
  const onMoveEnd: OnMoveEnd = (_event, viewport) => saveViewport(projectId, viewportUserId, viewport);
  return { initialViewport, onMoveEnd };
}

/**
 * Minimap props common to both canvases: `pannable` for press-and-hold-drag
 * panning, `zoomable`, plus the mask colour matching the app's dark theme
 * instead of the flow's default near-white overlay. The animated
 * pan-to-click lives on the minimap wrapper (`CanvasMinimap.svelte`).
 */
export const MINIMAP_PROPS = {
  zoomable: true,
  pannable: true,
  maskColor: "var(--color-overlay)",
  bgColor: "var(--color-surface)",
} as const;

class MinimapVisibility {
  visible = $state(loadShowMinimap());

  toggle = (): void => {
    this.visible = !this.visible;
    saveShowMinimap(this.visible);
  };
}

/**
 * The minimap's show/hide preference, shared by both canvases under the same
 * storage key — toggling it in one view carries over to the other instead of
 * each keeping its own. Read fresh per canvas mount, same as before.
 */
export function useSharedMinimapVisible(): MinimapVisibility {
  return new MinimapVisibility();
}
