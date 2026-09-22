<script lang="ts" module>
  import TableNode from "@/features/editor/nodes/TableNode.svelte";
  import ZoneNode from "@/features/editor/nodes/ZoneNode.svelte";
  import StickyNoteNode from "@/features/editor/nodes/StickyNoteNode.svelte";
  import EnumNode from "@/features/editor/nodes/EnumNode.svelte";
  import TableGroupNode from "@/features/editor/nodes/TableGroupNode.svelte";
  import RefEdge from "@/features/editor/edges/RefEdge.svelte";
  import type { NodeTypes, EdgeTypes } from "@xyflow/svelte";

  const nodeTypes = {
    table: TableNode,
    zone: ZoneNode,
    sticky: StickyNoteNode,
    enum: EnumNode,
    tablegroup: TableGroupNode,
  } as unknown as NodeTypes;
  const edgeTypes = { ref: RefEdge } as unknown as EdgeTypes;

  const GRID_SIZE = 10;
  /** Past this many pixels, a right-button press was a pan, not a click asking for the context menu. */
  const CONTEXT_MENU_DRAG_TOLERANCE_PX = 3;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import {
    Background,
    BackgroundVariant,
    Panel,
    SvelteFlow,
    useStore,
    useSvelteFlow,
    type Connection,
  } from "@xyflow/svelte";
  import type { Awareness } from "y-protocols/awareness.js";
  import type { DetailLevel } from "@athanordb/shared";
  import RemoteCursorsLayer from "@/features/collaboration/RemoteCursorsLayer.svelte";
  import type { RemoteSelector } from "@/features/collaboration/awarenessStates.svelte";
  import { useEscapeKey } from "@/hooks/escapeKey.svelte";
  import { loadGridStyle, loadSnapToGrid } from "@/utils/preferences";
  import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
  import type { CanvasExportHandle, CanvasNavigateHandle, CanvasNode } from "@/types";
  import type { RefEdgeType } from "@/features/editor/edges/refEdgeTypes";
  import type { CanvasNodesState } from "@/features/editor/hooks/useCanvasNodes/canvasNodes.svelte";
  import type { EditorViewMode } from "@/features/editor/mcd/ViewModeToggle.svelte";
  import { recordDuration, time } from "@/utils/perfMonitor";
  import CanvasContextMenu, { type CanvasContextMenuState } from "./CanvasContextMenu.svelte";
  import CanvasSearchPanel from "./CanvasSearchPanel.svelte";
  import CanvasToolbar from "./CanvasToolbar.svelte";
  import CanvasZoomBar from "./CanvasZoomBar.svelte";
  import CanvasMinimap from "./CanvasMinimap.svelte";
  import SelectionColorToolbar from "./SelectionColorToolbar.svelte";
  import { CANVAS_VIEWPORT_PROPS, jumpToTableNode, useSharedMinimapVisible, useSharedViewport } from "./canvasViewport.svelte";
  import { computeHighlightedFields } from "./highlightedFields";
  import { registerNodeInternalsFlush } from "./nodeInternalsBatch";
  import { createLassoSelection } from "./lassoSelection";
  import { publishSelecting } from "./selectionDragState.svelte";
  import { createCanvasImageExport } from "./canvasImageExport";
  import { useCanvasSearch } from "./canvasSearch.svelte";
  import { createCollaboratorCursor } from "./collaboratorCursor";
  import { useCanvasDeleteKey } from "./canvasDeleteKey.svelte";
  import { canvasMinimapNodeColor } from "./canvasMinimapColor";
  import { quantizeZoom, setCanvasContext } from "./canvasContext";
  import type { CanvasInsertTool, CanvasPoint } from "./types";

  /**
   * The diagram surface.
   *
   * Split out from `ProjectEditor` so it can use the flow's helpers
   * (`screenToFlowPosition`, `setCenter`, …) — they need the flow store, which
   * lives under the `SvelteFlowProvider` `ProjectEditor` wraps around this.
   * `screenToFlowPosition` is what turns a mouse move into the flow-space
   * coordinate broadcast as this user's cursor, so peers' `RemoteCursorsLayer`
   * renders it in the right spot regardless of each viewer's own pan/zoom.
   */
  let props: {
    /** The canvas's node state — the flow is bound two-way to its `nodes`. */
    nodesState: CanvasNodesState;
    edges: RefEdgeType[];
    /** Ids of the selected table nodes, derived once in `ProjectEditor`. */
    selectedTableIds: string[];
    /** tableId -> the remote collaborators who currently have that table selected. */
    remoteSelections: Map<string, RemoteSelector[]>;
    /** Deletes refs — the relation half of the Delete key. */
    onDeleteEdges: (edgeIds: string[]) => void;
    /** Fires when the user drags a field handle to another field handle — creates a new ref (FK). */
    onConnect: (connection: Connection) => void;
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
    showValidationIssues: boolean;
    onShowValidationIssuesChange: (visible: boolean) => void;
    projectId: string;
    /** Session's stable user id — namespaces the saved-viewport key, not an identity field. */
    viewportUserId: string;
    exportRef: { current: CanvasExportHandle | null };
    navigateRef: { current: CanvasNavigateHandle | null };
    canvasCommands: ResolvedContribution<CanvasCommandContribution>[];
    onRunCanvasCommand: (command: ResolvedContribution<CanvasCommandContribution>) => void;
    onOpenPlugins: () => void;
    /** Transient feedback from the last plugin command, shown above the toolbar. */
    statusMessage: string | null;
    /** Currently selected edge ID */
    selectedEdgeId: string | null;
    /** Select or unselect an edge */
    onSelectEdge: (edgeId: string | null) => void;
    /** Clears any active column selection when clicking empty canvas space. */
    onClearFieldSelection: () => void;
    /** False for a `view` grant — drops every editing affordance rather than offering ones whose writes the server discards. */
    canWrite: boolean;
    viewMode: EditorViewMode;
    onSetViewMode: (mode: EditorViewMode) => void;
  } = $props();

  const flow = useSvelteFlow<CanvasNode, RefEdgeType>();
  // `$derived`, not a plain call: under a provider, the real store only exists
  // once `<SvelteFlow>` below has mounted and registered it.
  const flowStore = $derived(useStore<CanvasNode, RefEdgeType>());

  let contextMenu = $state.raw<CanvasContextMenuState | null>(null);
  const minimap = useSharedMinimapVisible();
  /**
   * The Figma-style insert tool: pick one on the toolbar, then click anywhere
   * on the canvas to drop it there — and click again, and again, without
   * re-selecting the tool each time. `null` is the ordinary selection mode.
   */
  let activeInsertTool = $state<CanvasInsertTool | null>(null);
  const { initialViewport, onMoveEnd } = useSharedViewport(
    untrack(() => props.projectId),
    untrack(() => props.viewportUserId),
  );
  // Read once per mount, matching how the settings panel presents them: these
  // are "how the canvas behaves" preferences, not live controls.
  const gridStyle = loadGridStyle();
  const snapToGrid = loadSnapToGrid();

  let lassoRect: HTMLDivElement | undefined = $state();

  // One O(edges) pass for the whole canvas, replacing a per-table walk of the
  // edge array — see `highlightedFields.ts`.
  const highlightedFields = $derived(time("canvas.highlightedFields", () => computeHighlightedFields(props.edges)));
  const zoom = $derived(quantizeZoom(flowStore.viewport.zoom));

  setCanvasContext({
    get highlightedFields() {
      return highlightedFields;
    },
    get remoteSelections() {
      return props.remoteSelections;
    },
    get zoom() {
      return zoom;
    },
    deselectAllNodes: () => props.nodesState.setSelection(() => false),
  });

  // One batched re-measure per tick, replacing the separate call each table
  // used to make on its own — see `nodeInternalsBatch.ts`.
  $effect(() =>
    registerNodeInternalsFlush((ids) => {
      const store = untrack(() => flowStore);
      const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>();
      for (const id of ids) {
        const nodeElement = store.domNode?.querySelector<HTMLDivElement>(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
        if (nodeElement) updates.set(id, { id, nodeElement, force: true });
      }
      if (updates.size > 0) requestAnimationFrame(() => store.updateNodeInternals(updates));
    }),
  );

  // Diagnostic-only: how often the flow hands out a new nodes/edges array —
  // visible in the PerfHud as a frequency, not a duration.
  $effect(() => {
    void flowStore.nodes;
    recordDuration("store.nodesIdentityChanged", 0);
  });
  $effect(() => {
    void flowStore.edges;
    recordDuration("store.edgesIdentityChanged", 0);
  });

  // Nothing should stay "as if mid-drag" if this canvas unmounts while a
  // selection drag is somehow still in flight (switching projects, closing
  // the editor).
  $effect(() => () => publishSelecting(false));

  const jumpToTable = (tableId: string) =>
    jumpToTableNode(props.nodesState.nodes, tableId, flow.setCenter, props.nodesState.setSelection.bind(props.nodesState));

  // Imperative handles for the pieces that live outside this canvas (the
  // export dialog, the DBML panel's double-click navigation).
  $effect(() => {
    const exportRef = props.exportRef;
    exportRef.current = createCanvasImageExport(flow);
    return () => {
      exportRef.current = null;
    };
  });
  $effect(() => {
    const navigateRef = props.navigateRef;
    navigateRef.current = { goToTable: (tableId) => void jumpToTable(tableId) };
    return () => {
      navigateRef.current = null;
    };
  });

  const search = useCanvasSearch(() => props.nodesState.nodes, jumpToTable);

  const closeContextMenu = () => (contextMenu = null);

  // The first fit can run before the pane has its final size: the DBML panel
  // mounts in the same tick as the nodes, and the flow only learns its new
  // width from a ResizeObserver afterwards, so the diagram came out fitted to
  // the full window width and off-centre. Until the user moves the viewport
  // themselves, refit whenever the pane is resized.
  let userMovedViewport = false;
  $effect(() => {
    const width = flowStore.width;
    const height = flowStore.height;
    if (initialViewport || userMovedViewport || width === 0 || height === 0) return;
    untrack(() => {
      if (props.nodesState.nodes.length > 0) void flow.fitView();
    });
  });
  const onMoveStart = (event: MouseEvent | TouchEvent | null) => {
    if (event) userMovedViewport = true;
    closeContextMenu();
  };
  useEscapeKey(
    () => Boolean(contextMenu),
    closeContextMenu,
  );
  useEscapeKey(
    () => Boolean(activeInsertTool),
    () => (activeInsertTool = null),
  );

  $effect(() => {
    if (!contextMenu) return;
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("wheel", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("wheel", closeContextMenu);
    };
  });

  const cursor = createCollaboratorCursor(() => props.awareness, flow.screenToFlowPosition);
  $effect(() => () => cursor.dispose());

  /**
   * Broadcast this user's table selection — the Figma-style outline other
   * participants see on this project. Keyed on the joined id string, so an
   * unrelated update handing out a fresh (but equal) id array doesn't
   * re-broadcast.
   */
  const selectedTableIdsKey = $derived(props.selectedTableIds.join(","));
  $effect(() => {
    const key = selectedTableIdsKey;
    props.awareness?.setLocalStateField("selection", key ? key.split(",") : []);
  });

  function handleSelectInsertTool(tool: CanvasInsertTool) {
    // Clicking the active tool again is how you put the pointer back into
    // ordinary selection mode — the second half of the toggle Figma uses.
    activeInsertTool = activeInsertTool === tool ? null : tool;
  }

  function handlePaneClick(event: MouseEvent) {
    props.onClearFieldSelection();
    props.onSelectEdge(null);
    if (!activeInsertTool) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (activeInsertTool === "table") props.onAddTable(position);
    else if (activeInsertTool === "zone") props.onAddZone(position);
    else if (activeInsertTool === "note") props.onAddNote(position);
    else props.onAddEnum(position);
    // Deliberately left active: placing several tables in a row is the whole
    // point, and Escape (or picking the tool again) is how you stop.
  }

  /**
   * Right-click on empty canvas opens the insert menu — unless the right
   * button was dragged, which is a pan. The flow reserves the right button
   * for panning (`panOnDrag={[1, 2]}`) and so never reports a pane context
   * menu itself; the press position tells the two gestures apart here.
   */
  let rightPressAt: { x: number; y: number } | null = null;
  function handleContextMenu(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!target?.classList.contains("svelte-flow__pane")) return;
    event.preventDefault();
    const press = rightPressAt;
    rightPressAt = null;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CONTEXT_MENU_DRAG_TOLERANCE_PX) return;
    if (!props.canWrite) return;
    contextMenu = {
      screenX: event.clientX,
      screenY: event.clientY,
      flowPosition: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    };
  }

  useCanvasDeleteKey({
    canWrite: () => props.canWrite,
    selectedNodeIds: () => props.nodesState.nodes.filter((node) => node.selected).map((node) => node.id),
    selectedEdgeIds: () => (props.selectedEdgeId ? [props.selectedEdgeId] : []),
    deleteNodes: (ids) => props.nodesState.deleteNodes(ids),
    deleteEdges: (ids) => {
      props.onDeleteEdges(ids);
      if (props.selectedEdgeId && ids.includes(props.selectedEdgeId)) props.onSelectEdge(null);
    },
  });

  // Replaces the flow's own `selectionOnDrag` — see `lassoSelection.ts`.
  const onLassoPointerDown = createLassoSelection({
    nodes: () => props.nodesState.nodes,
    screenToFlowPosition: flow.screenToFlowPosition,
    select: (isSelected) => props.nodesState.setSelection(isSelected),
    rect: () => lassoRect,
  });

  const suppressNativeMenu = ({ event }: { event: MouseEvent }) => event.preventDefault();
</script>

<!--
  `canvas-links-highlighted` is the whole implementation of the "highlight
  every relation" toggle on the table side: one class here, combined in CSS
  with each row's own `is-fk` marker, instead of a flag threaded into every
  table node's data (which rebuilt and re-rendered the entire canvas on each
  flip).
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={`min-w-0 flex-1 bg-bg-canvas ${activeInsertTool ? "canvas-placing" : ""} ${
    props.highlightLinks ? "canvas-links-highlighted" : ""
  }`}
  onmousemove={cursor.onMouseMove}
  onmouseleave={cursor.onMouseLeave}
  onpointerdown={(event) => {
    if (event.button === 2) rightPressAt = { x: event.clientX, y: event.clientY };
    onLassoPointerDown(event);
  }}
  oncontextmenu={handleContextMenu}
  style:--canvas-font-scale={props.fontScale}
>
  <!-- Painted directly by the lasso (no reactive state per frame) — hidden until a drag starts. -->
  <div bind:this={lassoRect} class="lasso-selection-rect" style="display: none"></div>
  <SvelteFlow
    bind:nodes={props.nodesState.nodes}
    edges={props.edges}
    {nodeTypes}
    {edgeTypes}
    onconnect={props.onConnect}
    onpaneclick={({ event }) => handlePaneClick(event)}
    onedgeclick={({ edge }) => props.onSelectEdge(edge.id)}
    onnodeclick={() => props.onSelectEdge(null)}
    onnodecontextmenu={suppressNativeMenu}
    onselectioncontextmenu={suppressNativeMenu}
    onnodedragstart={({ nodes }) => props.nodesState.onDragStart(nodes)}
    onnodedrag={({ nodes }) => props.nodesState.onDrag(nodes)}
    onnodedragstop={({ nodes }) => props.nodesState.onDragStop(nodes)}
    onmovestart={onMoveStart}
    onmoveend={onMoveEnd}
    deleteKey={null}
    nodesDraggable={props.canWrite}
    nodesConnectable={props.canWrite}
    snapGrid={snapToGrid ? [GRID_SIZE, GRID_SIZE] : undefined}
    fitView={!initialViewport}
    initialViewport={initialViewport ?? undefined}
    panOnDrag={[1, 2]}
    {...CANVAS_VIEWPORT_PROPS}
    onlyRenderVisibleElements={false}
    proOptions={{ hideAttribution: true }}
  >
    <Background
      patternColor="var(--color-canvas-grid)"
      bgColor="var(--color-bg-canvas)"
      gap={20}
      variant={gridStyle as BackgroundVariant}
    />
    <RemoteCursorsLayer awareness={props.awareness} />
    <!-- Viewport control lives in its own corner pill: it is used at different
         moments from the editing tools, and pinning it left means it doesn't
         shift as the toolbar beside it grows. -->
    <Panel position="bottom-left" class="nodrag nopan !bottom-4 !left-4">
      <CanvasZoomBar selectedIds={props.selectedTableIds} />
    </Panel>
    <Panel position="bottom-center" class="nodrag nopan pointer-events-none !bottom-4 flex flex-col items-center gap-2">
      {#if props.statusMessage}
        <span
          class="pointer-events-auto rounded-full border border-border bg-surface-raised/95 px-3 py-1 text-[11.5px] text-text-secondary shadow-lg backdrop-blur-md"
        >
          {props.statusMessage}
        </span>
      {/if}
      <CanvasToolbar
        canWrite={props.canWrite}
        activeTool={activeInsertTool}
        onSelectTool={handleSelectInsertTool}
        activeDetailLevel={props.activeDetailLevel}
        onSetDetailLevel={props.onSetDetailLevel}
        highlightLinks={props.highlightLinks}
        onHighlightLinksChange={props.onHighlightLinksChange}
        showValidationIssues={props.showValidationIssues}
        onShowValidationIssuesChange={props.onShowValidationIssuesChange}
        minimapVisible={minimap.visible}
        onToggleMinimap={minimap.toggle}
        searchOpen={search.open}
        onToggleSearch={() => (search.open ? search.close() : search.setOpen(true))}
        canvasCommands={props.canvasCommands}
        onRunCanvasCommand={props.onRunCanvasCommand}
        onOpenPlugins={props.onOpenPlugins}
        viewMode={props.viewMode}
        onSetViewMode={props.onSetViewMode}
      />
    </Panel>
    {#if minimap.visible}
      <CanvasMinimap nodeColor={canvasMinimapNodeColor} />
    {/if}
    {#if props.selectedTableIds.length > 1 && props.canWrite}
      <SelectionColorToolbar
        count={props.selectedTableIds.length}
        palette={props.palette}
        onPick={(color) => props.onSetTablesColor(props.selectedTableIds, color)}
        onGroup={() => props.onGroupTables(props.selectedTableIds)}
      />
    {/if}
    {#if search.open}
      <CanvasSearchPanel
        query={search.query}
        onQueryChange={search.changeQuery}
        matchCount={search.matchIds.length}
        activeIndex={search.activeIndex}
        onNext={() => search.step(1)}
        onPrevious={() => search.step(-1)}
        onClose={search.close}
      />
    {/if}
  </SvelteFlow>
  {#if contextMenu}
    <CanvasContextMenu
      menu={contextMenu}
      onAddTable={props.onAddTable}
      onAddZone={props.onAddZone}
      onAddNote={props.onAddNote}
      onAddEnum={props.onAddEnum}
      onClose={closeContextMenu}
    />
  {/if}
</div>
