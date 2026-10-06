<script lang="ts" module>
  import EntityNode from "./EntityNode.svelte";
  import AssociationNode from "./AssociationNode.svelte";
  import McdEdge from "./McdEdge.svelte";
  import type { EdgeTypes, NodeTypes } from "@xyflow/svelte";

  const nodeTypes = { entity: EntityNode, association: AssociationNode } as unknown as NodeTypes;
  const edgeTypes = { mcd: McdEdge } as unknown as EdgeTypes;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { Background, BackgroundVariant, Panel, SvelteFlow } from "@xyflow/svelte";
  import { deriveMCD, type Project, type TableLock } from "@nebuladb/shared";
  import { loadGridStyle } from "@/utils/preferences";
  import {
    CANVAS_VIEWPORT_PROPS,
    useSharedMinimapVisible,
    useSharedViewport,
  } from "@/features/editor/canvas/canvasViewport.svelte";
  import CanvasZoomBar from "@/features/editor/canvas/CanvasZoomBar.svelte";
  import CanvasMinimap from "@/features/editor/canvas/CanvasMinimap.svelte";
  import McdToolbar from "./McdToolbar.svelte";
  import { buildMcdEdges, buildMcdNodes } from "./mcdNodes";
  import { computeMcdPositions } from "./mcdPositions";
  import { mcdMinimapNodeColor } from "./mcdMinimapColor";
  import McdWarningsBanner from "./McdWarningsBanner.svelte";
  import { useMcdNodeDrag } from "./mcdNodeDrag.svelte";
  import type { EditorViewMode } from "./ViewModeToggle.svelte";

    /**
     * A self-contained Merise MCD view, derived from the live `Project`, never the reverse. Its own
     * small flow rather than a mode of `CanvasArea`; nothing here writes to Yjs. It shares the zoom
     * bar, minimap and viewport behaviour (`canvasViewport`): a `minZoom` mismatch would let one
     * canvas clamp the other's saved zoom on mount.
     */
  let {
    project,
    projectId,
    viewportUserId,
    viewMode,
    onSetViewMode,
    locks,
  }: {
    project: Project;
    /** The project's table locks, by table id: a locked table keeps its padlock in this view. */
    locks: ReadonlyMap<string, TableLock>;
    projectId: string;
    viewportUserId: string;
    viewMode: EditorViewMode;
    onSetViewMode: (mode: EditorViewMode) => void;
  } = $props();

  const model = $derived(deriveMCD(project));
  const { initialViewport, onMoveEnd } = useSharedViewport(
    untrack(() => projectId),
    untrack(() => viewportUserId),
  );
  const minimap = useSharedMinimapVisible();
  // Same grid preference the MLD canvas reads — otherwise the two backgrounds
  // visibly differ (different dot colour/spacing) every time you switch.
  const gridStyle = loadGridStyle();

  const basePositions = $derived(computeMcdPositions(model, project));
  const baseNodes = $derived(buildMcdNodes(model, project, basePositions, locks));
  const drag = useMcdNodeDrag(() => baseNodes);
  const edges = $derived(buildMcdEdges(model));
  const selectedIds = $derived(drag.nodes.filter((n) => n.selected).map((n) => n.id));
</script>

<div class="relative h-full w-full">
  {#if model.warnings.length > 0}
    <McdWarningsBanner warnings={model.warnings} />
  {/if}
  <SvelteFlow
    bind:nodes={drag.nodes}
    {edges}
    {nodeTypes}
    {edgeTypes}
    onnodedragstart={drag.onDragStart}
    onnodedragstop={drag.onDragStop}
    nodesConnectable={false}
    edgesFocusable={false}
    fitView={!initialViewport}
    initialViewport={initialViewport ?? undefined}
    onmoveend={onMoveEnd}
    {...CANVAS_VIEWPORT_PROPS}
    proOptions={{ hideAttribution: true }}
  >
    <Background
      patternColor="var(--color-canvas-grid)"
      bgColor="var(--color-bg-canvas)"
      gap={20}
      variant={gridStyle as BackgroundVariant}
    />
    <Panel position="bottom-left" class="nodrag nopan !bottom-4 !left-4">
      <CanvasZoomBar {selectedIds} />
    </Panel>
    <Panel position="bottom-center" class="nodrag nopan !bottom-4">
      <McdToolbar
        {viewMode}
        {onSetViewMode}
        onResetPositions={drag.resetPositions}
        minimapVisible={minimap.visible}
        onToggleMinimap={minimap.toggle}
      />
    </Panel>
    {#if minimap.visible}
      <CanvasMinimap nodeColor={mcdMinimapNodeColor} />
    {/if}
  </SvelteFlow>
</div>
