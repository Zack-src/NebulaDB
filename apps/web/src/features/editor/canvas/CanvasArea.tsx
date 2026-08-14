import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import {
  ReactFlow,
  useReactFlow,
  Background,
  MiniMap,
  Panel,
  PanOnScrollMode,
  SelectionMode,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import type { Awareness } from "y-protocols/awareness.js";
import type { DetailLevel } from "@athanordb/shared";
import { TableNode } from "@/features/editor/nodes/TableNode";
import { RefEdge, type RefEdgeType } from "@/features/editor/edges/RefEdge";
import { ZoneNode } from "@/features/editor/nodes/ZoneNode";
import { StickyNoteNode } from "@/features/editor/nodes/StickyNoteNode";
import { EnumNode } from "@/features/editor/nodes/EnumNode";
import { TableGroupNode } from "@/features/editor/nodes/TableGroupNode";
import { CursorNode, type CursorNodeType } from "@/features/collaboration/CursorNode";
import { getSelectedWaypoint } from "@/features/editor/edges/waypointSelection";
import { isTypingTarget } from "@/utils/dom";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { loadShowMinimap, loadViewport, saveShowMinimap, saveViewport } from "@/utils/preferences";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import type { AllNodes, CanvasExportHandle, CanvasNode } from "@/types";
import { CanvasContextMenu, type CanvasContextMenuState } from "./CanvasContextMenu";
import { CanvasSearchPanel } from "./CanvasSearchPanel";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasZoomBar } from "./CanvasZoomBar";
import { SelectionColorToolbar } from "./SelectionColorToolbar";
import { useCanvasImageExport } from "./useCanvasImageExport";
import { useCanvasSearch } from "./useCanvasSearch";
import type { CanvasPoint } from "./types";

const nodeTypes = {
  table: TableNode,
  zone: ZoneNode,
  sticky: StickyNoteNode,
  enum: EnumNode,
  tablegroup: TableGroupNode,
  cursor: CursorNode,
};
const edgeTypes = { ref: RefEdge };

const PANE_SELECTOR = ".react-flow__pane";
const GRID_SIZE = 10;
const MIN_ZOOM = 0.05;

export interface CanvasAreaProps {
  nodes: CanvasNode[];
  cursorNodes: CursorNodeType[];
  edges: RefEdgeType[];
  onNodesChange: (changes: NodeChange<AllNodes>[]) => void;
  onEdgesDelete?: (edges: RefEdgeType[]) => void;
  /** Fires when the user drags a field handle to another field handle — creates a new ref (FK). */
  onConnect?: (connection: Connection) => void;
  awareness: Awareness | null;
  onAddTable: (position: CanvasPoint) => void;
  onAddZone: (position: CanvasPoint) => void;
  onAddNote: (position: CanvasPoint) => void;
  onAddEnum: (position: CanvasPoint) => void;
  /** Applies a header colour to every currently-selected table at once. */
  onSetTablesColor: (tableIds: string[], color: string) => void;
  /** Bundles the currently-selected tables into a named table group. */
  onGroupTables: (tableIds: string[]) => void;
  palette: string[];
  fontScale: number;
  onAdjustFontScale: (delta: number) => void;
  activeDetailLevel: DetailLevel | null;
  onSetDetailLevel: (level: DetailLevel) => void;
  highlightLinks: boolean;
  onHighlightLinksChange: (highlight: boolean) => void;
  /** Fires on table hover start/end (null on leave) — lets the parent highlight that table's refs. */
  onTableHoverChange: (tableId: string | null) => void;
  projectId: string;
  /** Session's stable user id — namespaces the saved-viewport key, not an identity field. */
  viewportUserId: string;
  exportRef: MutableRefObject<CanvasExportHandle | null>;
  canvasCommands: ResolvedContribution<CanvasCommandContribution>[];
  onRunCanvasCommand: (command: ResolvedContribution<CanvasCommandContribution>) => void;
  onOpenPlugins: () => void;
  /** Transient feedback from the last plugin command, shown above the toolbar. */
  statusMessage: string | null;
}

/**
 * The diagram surface.
 *
 * Split out from `ProjectEditor` so it can call `useReactFlow()` — that hook
 * only works inside a `ReactFlowProvider`, and `screenToFlowPosition` is what
 * turns a mouse move into the flow-space coordinate broadcast as this user's
 * cursor, so peers' `CursorNode`s land in the right spot regardless of each
 * viewer's own pan/zoom.
 */
export function CanvasArea(props: CanvasAreaProps) {
  const { screenToFlowPosition, deleteElements, getNodes, getEdges } = useReactFlow();
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [minimapVisible, setMinimapVisible] = useState(loadShowMinimap);
  // Lazy initializer: read once at mount, not on every render — this decides
  // whether the very first render asks React Flow to `fitView` or restores
  // exactly where this user left the canvas last time.
  const [initialViewport] = useState(() => loadViewport(props.projectId, props.viewportUserId));

  const { onNodesChange, onTableHoverChange, awareness, exportRef } = props;

  useCanvasImageExport(exportRef);
  const search = useCanvasSearch(props.nodes, onNodesChange);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const toggleMinimap = useCallback(() => {
    setMinimapVisible((visible) => {
      saveShowMinimap(!visible);
      return !visible;
    });
  }, []);

  const handleMouseMove = (event: ReactMouseEvent) => {
    awareness?.setLocalStateField("cursor", screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };
  const handleMouseLeave = () => awareness?.setLocalStateField("cursor", null);

  const handleNodeMouseEnter = useCallback(
    (_event: ReactMouseEvent, node: AllNodes) => {
      if (node.type === "table") onTableHoverChange(node.id);
    },
    [onTableHoverChange],
  );
  const handleNodeMouseLeave = useCallback(
    (_event: ReactMouseEvent, node: AllNodes) => {
      if (node.type === "table") onTableHoverChange(null);
    },
    [onTableHoverChange],
  );

  const handlePaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      setContextMenu({
        screenX: event.clientX,
        screenY: event.clientY,
        flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition],
  );

  useEscapeKey(Boolean(contextMenu), closeContextMenu);

  /**
   * Delete/Backspace, owned here instead of by React Flow's `deleteKeyCode`.
   *
   * React Flow binds that key on `document` and deletes the whole selection
   * without asking anyone else — so pressing Delete with an edge waypoint
   * selected removed the entire relation from the schema, while the waypoint's
   * own handler ran too. One handler with an explicit order of precedence is
   * the only way to make "delete this corner" and "delete this table" the same
   * key: the waypoint claims the keystroke first, and everything else falls
   * through to the normal selection delete.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      if (getSelectedWaypoint()) return;
      const nodes = getNodes().filter((node) => node.selected && node.type !== "cursor");
      const edges = getEdges().filter((edge) => edge.selected);
      if (nodes.length === 0 && edges.length === 0) return;
      event.preventDefault();
      void deleteElements({ nodes, edges });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteElements, getNodes, getEdges]);

  useEffect(() => {
    if (!contextMenu) return;
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("wheel", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("wheel", closeContextMenu);
    };
  }, [contextMenu, closeContextMenu]);

  /**
   * Where the toolbar's insert buttons drop a new node: the centre of the
   * visible pane, so it lands where the user is looking rather than at a fixed
   * flow coordinate they may have panned away from.
   */
  const paneCenter = useCallback((): CanvasPoint => {
    const pane = document.querySelector(PANE_SELECTOR) as HTMLElement | null;
    const rect = pane?.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
  }, [screenToFlowPosition]);

  const allNodes: AllNodes[] = [...props.nodes, ...props.cursorNodes];
  const selectedTableIds = props.nodes.filter((node) => node.type === "table" && node.selected).map((node) => node.id);

  return (
    <div
      className="min-w-0 flex-1 bg-bg-canvas"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ "--canvas-font-scale": props.fontScale } as CSSProperties}
    >
      <ReactFlow
        nodes={allNodes}
        edges={props.edges}
        onNodesChange={onNodesChange}
        onEdgesDelete={props.onEdgesDelete}
        onConnect={props.onConnect}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onMoveStart={closeContextMenu}
        onMoveEnd={(_event, viewport) => saveViewport(props.projectId, props.viewportUserId, viewport)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Deletion is handled by the effect above so a selected edge waypoint
        // can take precedence over the relation it belongs to.
        deleteKeyCode={null}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        fitView={!initialViewport}
        defaultViewport={initialViewport ?? undefined}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomActivationKeyCode="Control"
        minZoom={MIN_ZOOM}
        // A schema with hundreds of tables otherwise mounts every TableNode's
        // full DOM (every field row, every handle) regardless of what's
        // actually panned into view. React Flow already tracks each node's
        // position/size for its own viewport-culling math, so nothing outside
        // the visible area (plus a small margin) gets rendered at all.
        // fitView/minimap/collaborator cursors are unaffected — they read node
        // geometry, not the DOM.
        onlyRenderVisibleElements
      >
        <Background color="#33353c" gap={20} />
        {/* Viewport control lives in its own corner pill: it is used at
            different moments from the editing tools, and pinning it left means
            it doesn't shift as the toolbar beside it grows. */}
        <Panel position="bottom-left" className="nodrag nopan !bottom-4 !left-4">
          <CanvasZoomBar selectedIds={selectedTableIds} />
        </Panel>
        <Panel
          position="bottom-center"
          className="nodrag nopan pointer-events-none !bottom-4 flex flex-col items-center gap-2"
        >
          {props.statusMessage && (
            <span className="pointer-events-auto rounded-full border border-border bg-surface-raised/95 px-3 py-1 text-[11.5px] text-text-secondary shadow-lg backdrop-blur-md">
              {props.statusMessage}
            </span>
          )}
          <CanvasToolbar
            onAddTable={props.onAddTable}
            onAddZone={props.onAddZone}
            onAddNote={props.onAddNote}
            onAddEnum={props.onAddEnum}
            insertPosition={paneCenter}
            fontScale={props.fontScale}
            onAdjustFontScale={props.onAdjustFontScale}
            activeDetailLevel={props.activeDetailLevel}
            onSetDetailLevel={props.onSetDetailLevel}
            highlightLinks={props.highlightLinks}
            onHighlightLinksChange={props.onHighlightLinksChange}
            minimapVisible={minimapVisible}
            onToggleMinimap={toggleMinimap}
            searchOpen={search.open}
            onOpenSearch={() => search.setOpen(true)}
            canvasCommands={props.canvasCommands}
            onRunCanvasCommand={props.onRunCanvasCommand}
            onOpenPlugins={props.onOpenPlugins}
          />
        </Panel>
        {minimapVisible && (
          <MiniMap pannable zoomable bgColor="#1f2024" nodeColor="#4b4d8a" maskColor="rgba(23,24,27,0.75)" />
        )}
        {selectedTableIds.length > 1 && (
          <SelectionColorToolbar
            count={selectedTableIds.length}
            palette={props.palette}
            onPick={(color) => props.onSetTablesColor(selectedTableIds, color)}
            onGroup={() => props.onGroupTables(selectedTableIds)}
          />
        )}
        {search.open && (
          <CanvasSearchPanel
            query={search.query}
            onQueryChange={search.changeQuery}
            matchCount={search.matchIds.length}
            activeIndex={search.activeIndex}
            onNext={() => search.step(1)}
            onPrevious={() => search.step(-1)}
            onClose={search.close}
          />
        )}
      </ReactFlow>
      {contextMenu && (
        <CanvasContextMenu
          menu={contextMenu}
          onAddTable={props.onAddTable}
          onAddZone={props.onAddZone}
          onAddNote={props.onAddNote}
          onAddEnum={props.onAddEnum}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
