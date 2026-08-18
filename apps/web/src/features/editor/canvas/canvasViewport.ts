import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { PanOnScrollMode, useReactFlow, type MiniMapProps, type NodeChange, type OnMoveEnd } from "@xyflow/react";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";
import { loadShowMinimap, loadViewport, saveShowMinimap, saveViewport } from "@/utils/preferences";
import type { CanvasNavigateHandle, CanvasNode } from "@/types";

/** Shared by every "jump to a table" gesture — canvas search (Ctrl+F) and the DBML editor's double-click-to-canvas navigation. */
const JUMP_ZOOM = 1;
const JUMP_DURATION_MS = 300;

/**
 * Centers the viewport on `tableId` and selects it — the same select-change
 * path a real click goes through, so the target gets the ordinary selection
 * outline instead of a bespoke "found"/"navigated" style. Returns whether a
 * matching node was actually found.
 */
export function jumpToTableNode(
  nodes: CanvasNode[],
  tableId: string,
  setCenter: ReturnType<typeof useReactFlow>["setCenter"],
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void,
): boolean {
  const node = nodes.find((candidate) => candidate.id === tableId);
  if (!node) return false;
  const width = node.measured?.width ?? DEFAULT_TABLE_WIDTH;
  const height = node.measured?.height ?? DEFAULT_TABLE_HEIGHT;
  setCenter(node.position.x + width / 2, node.position.y + height / 2, {
    zoom: JUMP_ZOOM,
    duration: JUMP_DURATION_MS,
  });
  onNodesChange(
    nodes
      .filter((candidate) => candidate.type === "table")
      .map((candidate) => ({ id: candidate.id, type: "select" as const, selected: candidate.id === tableId })),
  );
  return true;
}

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
 * Minimap props common to both canvases: a smooth animated pan-to-click, plus
 * `pannable` for press-and-hold-drag panning, plus the mask colour matching
 * the app's dark theme instead of React Flow's default near-white overlay.
 *
 * `onClick` and `pannable` are two independent gestures under the hood — a
 * plain click (no pointer movement between down/up) fires `onClick` below
 * for the animated jump; an actual drag is driven straight from
 * `pannable`'s own d3-drag handler for instant, 1:1 continuous panning, with
 * no `duration` to animate even if we wanted one. They don't fight each
 * other, so both can be on at once.
 */
export function useMinimapPanProps(): Pick<
  MiniMapProps,
  "zoomable" | "pannable" | "onClick" | "maskColor" | "bgColor"
> {
  const { setCenter, getZoom } = useReactFlow();
  const onClick = useCallback<NonNullable<MiniMapProps["onClick"]>>(
    (_event, position) => {
      setCenter(position.x, position.y, { zoom: getZoom(), duration: MINIMAP_PAN_DURATION_MS });
    },
    [setCenter, getZoom],
  );
  return {
    zoomable: true,
    pannable: true,
    onClick,
    maskColor: "var(--color-overlay)",
    bgColor: "var(--color-surface)",
  };
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

/**
 * Publishes an imperative "go to this table" handle, populated from an
 * effect (not during render — writing to someone else's ref mid-render is
 * exactly the side effect React's rules forbid). Imperative for the same
 * reason `useCanvasImageExport` is: the DBML panel this drives lives outside
 * this canvas's `ReactFlowProvider`, so it has no other way to reach
 * `setCenter`.
 */
export function useCanvasNavigate(
  navigateRef: MutableRefObject<CanvasNavigateHandle | null>,
  nodes: CanvasNode[],
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void,
): void {
  const { setCenter } = useReactFlow();

  useEffect(() => {
    navigateRef.current = {
      goToTable: (tableId) => {
        jumpToTableNode(nodes, tableId, setCenter, onNodesChange);
      },
    };
    return () => {
      navigateRef.current = null;
    };
  }, [navigateRef, nodes, onNodesChange, setCenter]);
}
