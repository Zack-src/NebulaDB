import {
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ProfilerOnRenderCallback,
} from "react";
import {
  ReactFlow,
  useReactFlow,
  Background,
  MiniMap,
  Panel,
  BackgroundVariant,
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
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { loadGridStyle, loadSnapToGrid } from "@/utils/preferences";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import type { AllNodes, CanvasExportHandle, CanvasNavigateHandle, CanvasNode } from "@/types";
import { CanvasContextMenu, type CanvasContextMenuState } from "./CanvasContextMenu";
import { CanvasSearchPanel } from "./CanvasSearchPanel";
import { CanvasToolbar } from "./CanvasToolbar";
import type { EditorViewMode } from "@/features/editor/mcd/ViewModeToggle";
import {
  CANVAS_VIEWPORT_PROPS,
  useCanvasNavigate,
  useMinimapPanProps,
  useSharedMinimapVisible,
  useSharedViewport,
} from "./canvasViewport";
import { CanvasZoomBar } from "./CanvasZoomBar";
import { useStoreChurnProbe } from "./useStoreChurnProbe";
import { useHighlightedFieldsPublisher } from "./highlightedFields";
import { recordDuration } from "@/utils/perfMonitor";
import { SelectionColorToolbar } from "./SelectionColorToolbar";
import { useCanvasImageExport } from "./useCanvasImageExport";
import { useCanvasSearch } from "./useCanvasSearch";
import { useCollaboratorCursor } from "./useCollaboratorCursor";
import { useCanvasDeleteKey } from "./useCanvasDeleteKey";
import { canvasMinimapNodeColor } from "./canvasMinimapColor";
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
  navigateRef: MutableRefObject<CanvasNavigateHandle | null>;
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
  viewMode: EditorViewMode;
  onSetViewMode: (mode: EditorViewMode) => void;
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
  const { screenToFlowPosition } = useReactFlow();
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const { visible: minimapVisible, toggle: toggleMinimap } = useSharedMinimapVisible();
  /**
   * The Figma-style insert tool: pick one on the toolbar, then click anywhere
   * on the canvas to drop it there — and click again, and again, without
   * re-selecting the tool each time. `null` is the ordinary selection mode.
   */
  const [activeInsertTool, setActiveInsertTool] = useState<CanvasInsertTool | null>(null);
  const { initialViewport, onMoveEnd } = useSharedViewport(props.projectId, props.viewportUserId);
  const minimapPanProps = useMinimapPanProps();
  // Read once per mount, matching how the settings panel presents them: these
  // are "how the canvas behaves" preferences, not live controls. Before this
  // they were read by nothing at all — the settings switches wrote to state
  // that no component consumed.
  const [gridStyle] = useState(loadGridStyle);
  const [snapToGrid] = useState(loadSnapToGrid);

  const { onNodesChange, awareness, exportRef, navigateRef } = props;

  useStoreChurnProbe();
  // One O(edges) pass for the whole canvas, replacing the per-table store
  // selector each `TableNode` used to run — see `highlightedFields.ts`.
  useHighlightedFieldsPublisher();
  useCanvasImageExport(exportRef);
  useCanvasNavigate(navigateRef, props.nodes, onNodesChange);
  const search = useCanvasSearch(props.nodes, onNodesChange);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const suppressNativeMenu = useCallback((event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault();
  }, []);

  const { onMouseMove: handleCursorMove, onMouseLeave: handleCursorLeave } = useCollaboratorCursor(awareness);

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

  useCanvasDeleteKey(props.canWrite);

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

  // React's own render/commit cost for the whole node tree (every table,
  // edge, zone...) — the piece a `time()` span around a data-building
  // function above can't see, since it only covers building props, not
  // React reconciling and painting them.
  const onRenderCanvas: ProfilerOnRenderCallback = useCallback((_id, phase, actualDuration) => {
    recordDuration(`canvas.render.${phase}`, actualDuration);
  }, []);

  return (
    <div
      // `canvas-links-highlighted` is the whole implementation of the
      // "highlight every relation" toggle on the table side: one class here,
      // combined in CSS with each row's own `is-fk` marker, instead of a
      // `highlightLinks` prop threaded into every table node's data (which
      // rebuilt and re-rendered the entire canvas on each flip).
      className={`min-w-0 flex-1 bg-bg-canvas ${activeInsertTool ? "canvas-placing" : ""} ${
        props.highlightLinks ? "canvas-links-highlighted" : ""
      }`}
      onMouseMove={handleCursorMove}
      onMouseLeave={handleCursorLeave}
      style={{ "--canvas-font-scale": props.fontScale } as CSSProperties}
    >
      <Profiler id="canvas" onRender={onRenderCanvas}>
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
          onMoveEnd={onMoveEnd}
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
          {...CANVAS_VIEWPORT_PROPS}
          // Deliberately OFF, despite the obvious appeal for "hundreds of
          // tables" — measured to be the wrong trade at that scale, not just
          // untested. Turning it on culls DOM nodes outside the viewport, but
          // that culling is exactly what was mounting/unmounting `TableNode`
          // instances on every pan/zoom tick; profiling a 200-table schema
          // (`apps/server/scripts/bench.ts`-adjacent browser scenario, see
          // the perf investigation in git history) showed ~9.5s of main-thread
          // longtasks across a pan/zoom/drag sequence with it on, vs ~2.4s
          // with it off — the mount/unmount churn cost far more than the
          // saved paint work bought back, at this table count. Revisit if a
          // schema large enough to make *initial* mount the bottleneck instead
          // becomes a real usage pattern (untested past ~200 tables).
          onlyRenderVisibleElements={false}
        >
          <Background
            color="var(--color-canvas-grid)"
            bgColor="var(--color-bg-canvas)"
            gap={20}
            variant={gridStyle as BackgroundVariant}
          />
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
              viewMode={props.viewMode}
              onSetViewMode={props.onSetViewMode}
            />
          </Panel>
          {minimapVisible && (
            <MiniMap {...minimapPanProps} onContextMenu={suppressNativeMenu} nodeColor={canvasMinimapNodeColor} />
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
      </Profiler>
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
