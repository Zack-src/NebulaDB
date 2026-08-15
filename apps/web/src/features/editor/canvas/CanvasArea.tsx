import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  BackgroundVariant,
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
import { RemoteCursorsLayer } from "@/features/collaboration/RemoteCursorsLayer";
import type { RemoteSelector } from "@/features/collaboration/useRemoteSelections";
import { getSelectedWaypoint } from "@/features/editor/edges/waypointSelection";
import { isTypingTarget } from "@/utils/dom";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  loadGridStyle,
  loadShowMinimap,
  loadSnapToGrid,
  loadViewport,
  saveShowMinimap,
  saveViewport,
} from "@/utils/preferences";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import type { AllNodes, CanvasExportHandle, CanvasNode } from "@/types";
import { DEFAULT_HEADER_COLOR } from "@/features/editor/nodes/table/TableSettingsPopover";
import { CanvasContextMenu, type CanvasContextMenuState } from "./CanvasContextMenu";
import { CanvasSearchPanel } from "./CanvasSearchPanel";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasZoomBar } from "./CanvasZoomBar";
import { SelectionColorToolbar } from "./SelectionColorToolbar";
import { useCanvasImageExport } from "./useCanvasImageExport";
import { useCanvasSearch } from "./useCanvasSearch";
import type { CanvasInsertTool, CanvasPoint } from "./types";

const nodeTypes = {
  table: TableNode,
  zone: ZoneNode,
  sticky: StickyNoteNode,
  enum: EnumNode,
  tablegroup: TableGroupNode,
};
const edgeTypes = { ref: RefEdge };

const GRID_SIZE = 10;
const MIN_ZOOM = 0.05;

export interface CanvasAreaProps {
  nodes: CanvasNode[];
  /** tableId -> the remote collaborators who currently have that table selected — see `useRemoteSelections`. */
  remoteSelections: Map<string, RemoteSelector[]>;
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
  activeDetailLevel: DetailLevel | null;
  onSetDetailLevel: (level: DetailLevel) => void;
  highlightLinks: boolean;
  onHighlightLinksChange: (highlight: boolean) => void;
  projectId: string;
  /** Session's stable user id — namespaces the saved-viewport key, not an identity field. */
  viewportUserId: string;
  exportRef: MutableRefObject<CanvasExportHandle | null>;
  canvasCommands: ResolvedContribution<CanvasCommandContribution>[];
  onRunCanvasCommand: (command: ResolvedContribution<CanvasCommandContribution>) => void;
  onOpenPlugins: () => void;
  /** Transient feedback from the last plugin command, shown above the toolbar. */
  statusMessage: string | null;
  /** Currently selected edge ID */
  selectedEdgeId?: string | null;
  /** Select or unselect an edge */
  onSelectEdge?: (edgeId: string | null) => void;
  /** Clears any active column selection when clicking empty canvas space. */
  onClearFieldSelection?: () => void;
  /** False for a `view` grant — drops every editing affordance rather than offering ones whose writes the server discards. */
  canWrite: boolean;
}

/**
 * The diagram surface.
 *
 * Split out from `ProjectEditor` so it can call `useReactFlow()` — that hook
 * only works inside a `ReactFlowProvider`, and `screenToFlowPosition` is what
 * turns a mouse move into the flow-space coordinate broadcast as this user's
 * cursor, so peers' `RemoteCursorsLayer` renders it in the right spot
 * regardless of each viewer's own pan/zoom.
 */
export function CanvasArea(props: CanvasAreaProps) {
  const { screenToFlowPosition, deleteElements, getNodes, getEdges } = useReactFlow();
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [minimapVisible, setMinimapVisible] = useState(loadShowMinimap);
  /**
   * The Figma-style insert tool: pick one on the toolbar, then click anywhere
   * on the canvas to drop it there — and click again, and again, without
   * re-selecting the tool each time. `null` is the ordinary selection mode.
   */
  const [activeInsertTool, setActiveInsertTool] = useState<CanvasInsertTool | null>(null);
  // Lazy initializer: read once at mount, not on every render — this decides
  // whether the very first render asks React Flow to `fitView` or restores
  // exactly where this user left the canvas last time.
  const [initialViewport] = useState(() => loadViewport(props.projectId, props.viewportUserId));
  // Read once per mount, matching how the settings panel presents them: these
  // are "how the canvas behaves" preferences, not live controls. Before this
  // they were read by nothing at all — the settings switches wrote to state
  // that no component consumed.
  const [gridStyle] = useState(loadGridStyle);
  const [snapToGrid] = useState(loadSnapToGrid);

  const { onNodesChange, awareness, exportRef } = props;

  useCanvasImageExport(exportRef);
  const search = useCanvasSearch(props.nodes, onNodesChange);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const suppressNativeMenu = useCallback((event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault();
  }, []);

  const toggleMinimap = useCallback(() => {
    setMinimapVisible((visible) => {
      saveShowMinimap(!visible);
      return !visible;
    });
  }, []);

  /**
   * Collaborator cursor broadcast, throttled to one animation frame.
   *
   * `mousemove` fires far faster than anything anyone can see — several times
   * per frame on a high-polling mouse — and every call put an awareness update
   * on the WebSocket *and* re-rendered every peer's `RemoteCursorsLayer`. One
   * position per frame is the most that can ever be displayed, so the rest
   * was pure load on the socket and on every peer.
   */
  const pendingCursorRef = useRef<CanvasPoint | null>(null);
  const cursorFrameRef = useRef<number | null>(null);

  const handleMouseMove = useCallback(
    (event: ReactMouseEvent) => {
      if (!awareness) return;
      pendingCursorRef.current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (cursorFrameRef.current !== null) return;
      cursorFrameRef.current = requestAnimationFrame(() => {
        cursorFrameRef.current = null;
        if (pendingCursorRef.current) awareness.setLocalStateField("cursor", pendingCursorRef.current);
      });
    },
    [awareness, screenToFlowPosition],
  );

  const handleMouseLeave = useCallback(() => {
    pendingCursorRef.current = null;
    if (cursorFrameRef.current !== null) {
      cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null;
    }
    awareness?.setLocalStateField("cursor", null);
  }, [awareness]);

  useEffect(
    () => () => {
      if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current);
    },
    [],
  );

  const canAddNodes = props.canWrite;
  const handlePaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      if (!canAddNodes) return;
      setContextMenu({
        screenX: event.clientX,
        screenY: event.clientY,
        flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition, canAddNodes],
  );

  useEscapeKey(Boolean(contextMenu), closeContextMenu);

  const handleSelectInsertTool = useCallback((tool: CanvasInsertTool) => {
    // Clicking the active tool again is how you put the pointer back into
    // ordinary selection mode — the second half of the toggle Figma uses.
    setActiveInsertTool((current) => (current === tool ? null : tool));
  }, []);
  useEscapeKey(Boolean(activeInsertTool), () => setActiveInsertTool(null));

  const { onAddTable, onAddZone, onAddNote, onAddEnum, onClearFieldSelection, onSelectEdge } = props;
  const handlePaneClick = useCallback(
    (event: ReactMouseEvent) => {
      onClearFieldSelection?.();
      onSelectEdge?.(null);
      if (!activeInsertTool) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (activeInsertTool === "table") onAddTable(position);
      else if (activeInsertTool === "zone") onAddZone(position);
      else if (activeInsertTool === "note") onAddNote(position);
      else onAddEnum(position);
      // Deliberately left active: placing several tables in a row is the
      // whole point, and Escape (or picking the tool again) is how you stop.
    },
    [
      activeInsertTool,
      screenToFlowPosition,
      onAddTable,
      onAddZone,
      onAddNote,
      onAddEnum,
      onClearFieldSelection,
      onSelectEdge,
    ],
  );

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
  const canWriteRef = useRef(props.canWrite);
  useEffect(() => {
    canWriteRef.current = props.canWrite;
  }, [props.canWrite]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      if (!canWriteRef.current) return;
      if (getSelectedWaypoint()) return;
      const nodes = getNodes().filter((node) => node.selected);
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

  const selectedTableIds = props.nodes.filter((node) => node.type === "table" && node.selected).map((node) => node.id);

  /**
   * Broadcast this user's table selection — the Figma-style outline other
   * participants see on this project. Keyed on the joined id string rather
   * than the array itself: `selectedTableIds` is a fresh array every render,
   * which would otherwise fire this on every unrelated re-render of `CanvasArea`.
   */
  const selectedTableIdsKey = selectedTableIds.join(",");
  useEffect(() => {
    awareness?.setLocalStateField("selection", selectedTableIdsKey ? selectedTableIdsKey.split(",") : []);
  }, [selectedTableIdsKey, awareness]);

  const { remoteSelections } = props;
  const nodesWithRemoteSelection = useMemo(() => {
    if (remoteSelections.size === 0) return props.nodes;
    return props.nodes.map((node) => {
      if (node.type !== "table") return node;
      const selectors = remoteSelections.get(node.id);
      if (!selectors) return node;
      return { ...node, data: { ...node.data, remoteSelectedBy: selectors } };
    });
  }, [props.nodes, remoteSelections]);

  return (
    <div
      className={`min-w-0 flex-1 bg-bg-canvas ${activeInsertTool ? "canvas-placing" : ""}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ "--canvas-font-scale": props.fontScale } as CSSProperties}
    >
      <ReactFlow
        nodes={nodesWithRemoteSelection}
        edges={props.edges}
        onNodesChange={onNodesChange}
        onEdgesDelete={props.onEdgesDelete}
        onConnect={props.onConnect}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onEdgeClick={(_event, edge) => onSelectEdge?.(edge.id)}
        onNodeClick={() => onSelectEdge?.(null)}
        // Without these two, right-clicking a table (or a multi-selection)
        // fell through to the browser's own menu — "Save image as…", "Reload"
        // — on top of the diagram. Suppressing the native menu is what the
        // `preventDefault` does; the app's own menu stays pane-only, since
        // there is no per-node menu to offer yet.
        onNodeContextMenu={suppressNativeMenu}
        onSelectionContextMenu={suppressNativeMenu}
        onMoveStart={closeContextMenu}
        onMoveEnd={(_event, viewport) => saveViewport(props.projectId, props.viewportUserId, viewport)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Deletion is handled by the effect above so a selected edge waypoint
        // can take precedence over the relation it belongs to.
        deleteKeyCode={null}
        nodesDraggable={props.canWrite}
        nodesConnectable={props.canWrite}
        snapToGrid={snapToGrid}
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
        // fitView/minimap are unaffected — they read node geometry, not the
        // DOM. Collaborator cursors aren't nodes at all (see
        // `RemoteCursorsLayer`), so this doesn't touch them either.
        onlyRenderVisibleElements
      >
        <Background color="var(--color-canvas-grid)" gap={20} variant={gridStyle as BackgroundVariant} />
        <RemoteCursorsLayer awareness={awareness} />
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
            canWrite={props.canWrite}
            activeTool={activeInsertTool}
            onSelectTool={handleSelectInsertTool}
            activeDetailLevel={props.activeDetailLevel}
            onSetDetailLevel={props.onSetDetailLevel}
            highlightLinks={props.highlightLinks}
            onHighlightLinksChange={props.onHighlightLinksChange}
            minimapVisible={minimapVisible}
            onToggleMinimap={toggleMinimap}
            searchOpen={search.open}
            onToggleSearch={() => (search.open ? search.close() : search.setOpen(true))}
            canvasCommands={props.canvasCommands}
            onRunCanvasCommand={props.onRunCanvasCommand}
            onOpenPlugins={props.onOpenPlugins}
          />
        </Panel>
        {minimapVisible && (
          <MiniMap
            pannable
            zoomable
            onContextMenu={suppressNativeMenu}
            bgColor="var(--color-surface)"
            nodeColor={(node) => {
              if (node.type === "table") {
                const data = node.data as { table?: { style?: { color?: string } } } | undefined;
                return data?.table?.style?.color || DEFAULT_HEADER_COLOR;
              }
              if (node.type === "zone") {
                const data = node.data as { zone?: { style?: { color?: string } } } | undefined;
                return data?.zone?.style?.color || "#f59e0b";
              }
              if (node.type === "sticky") {
                const data = node.data as { note?: { style?: { color?: string } } } | undefined;
                return data?.note?.style?.color || "#fef08a";
              }
              if (node.type === "enum") {
                return "#06b6d4";
              }
              if (node.type === "tablegroup") {
                return "#a855f7";
              }
              return "var(--color-primary)";
            }}
            maskColor="var(--color-overlay)"
          />
        )}
        {selectedTableIds.length > 1 && props.canWrite && (
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
