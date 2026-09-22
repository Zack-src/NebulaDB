<script lang="ts">
  import { portal } from "@xyflow/svelte";
  import type { EdgeRouting } from "@/features/editor/edges/edgeRouting.svelte";
  import type { RefEdgeData } from "@/features/editor/edges/refEdgeTypes";
  import EdgeWaypoints from "./EdgeWaypoints.svelte";
  import CardinalityBadge from "./CardinalityBadge.svelte";
  import EdgeCardinalityLabels from "./EdgeCardinalityLabels.svelte";
  import EdgeContextMenu from "./EdgeContextMenu.svelte";

  /**
   * The cardinality chips, waypoint dots, midpoint toolbar and context menu
   * for one relation — everything `RefEdge` portals into the flow's
   * edge-label layer.
   *
   * Pulled out into its own component (rather than an inline `<div
   * use:portal>` in `RefEdge.svelte`) because a literal HTML tag written
   * directly in an edge component's top-level markup makes Svelte fall back
   * to the HTML namespace for that *whole* shared template — including the
   * unrelated SVG `<path>` elements sitting next to it. Svelte Flow's own
   * `EdgeLabel.svelte` uses the exact same "opaque child component" shape for
   * the same reason; an inline `<div>` here reproduced the same bug (see the
   * fixed regression: a relation stayed highlighted after a click elsewhere,
   * because the flow's own click-to-select never reached a real SVG element).
   */
  let {
    sourceX,
    sourceY,
    targetX,
    targetY,
    labelX,
    labelY,
    selected,
    zoom,
    strokeColor,
    style,
    data,
    routing,
    isHighlighted,
    showEditingControls,
    endpointLabels,
  }: {
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
    labelX: number;
    labelY: number;
    selected: boolean;
    zoom: number;
    strokeColor: string;
    style: { label: string };
    data: RefEdgeData | undefined;
    routing: EdgeRouting;
    isHighlighted: boolean;
    showEditingControls: boolean;
    endpointLabels: [string, string];
  } = $props();
</script>

<div use:portal={"edge-labels"} class="contents">
  {#if isHighlighted}
    <EdgeCardinalityLabels
      points={routing.drawnPoints}
      sourceLabel={endpointLabels[0]}
      targetLabel={endpointLabels[1]}
      sourceSlot={data?.sourceSlot ?? 0}
      targetSlot={data?.targetSlot ?? 0}
      color={strokeColor}
      opacity={selected ? 1 : 0.95}
      {zoom}
    />
  {/if}
  {#if showEditingControls}
    <EdgeWaypoints
      points={routing.points}
      source={{ x: sourceX, y: sourceY }}
      target={{ x: targetX, y: targetY }}
      selectedIndex={routing.selectedPointIndex}
      candidatePoint={routing.candidatePoint}
      {strokeColor}
      {zoom}
      onStartDrag={routing.startDrag}
      onSelect={routing.setSelectedPointIndex}
      onContextMenu={routing.openContextMenu}
      onInsertCandidate={routing.insertPointAt}
    />
  {/if}
  {#if showEditingControls && data}
    <CardinalityBadge
      x={labelX}
      y={labelY}
      label={style.label}
      cardinality={data.cardinality}
      onCardinalityChange={data.onCardinalityChange}
      onDelete={data.onDelete}
      onUpdate={data.onUpdate}
      onDeleteActionChange={data.onDeleteActionChange}
      onUpdateActionChange={data.onUpdateActionChange}
      onReverseDirection={data.onReverseDirection}
      color={strokeColor}
      {zoom}
      palette={data.palette}
      onPaletteChange={data.onPaletteChange}
      onColorChange={data.onColorChange}
      showReset={routing.hasCustomRouting || routing.points.length !== routing.defaultCorners.length}
      onReset={routing.resetRouting}
      onDeleteRef={data.onDeleteRef}
      onContextMenu={(event) => routing.openContextMenu(event)}
    />
  {/if}
  {#if routing.contextMenu}
    <EdgeContextMenu
      menu={routing.contextMenu}
      onClose={routing.closeContextMenu}
      onInsertPoint={routing.insertPointAt}
      onDeletePoint={routing.deletePointAt}
      onResetRouting={routing.resetRouting}
      onResetColor={data?.color ? () => data?.onColorChange(undefined) : undefined}
      onReverseDirection={data?.onReverseDirection}
      onDeleteRef={data?.onDeleteRef}
    />
  {/if}
</div>
