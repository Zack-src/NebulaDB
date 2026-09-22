<script lang="ts" module>
  /** Colour of a relation nobody is looking at — deliberately low-contrast so a dense schema reads as structure rather than spaghetti. */
  const DIMMED_STROKE = "#475569";
  /** A ref with a validation issue draws in this colour at all times (not just on hover/selection) — it's the one thing on the canvas that should stay visible even in a dense, otherwise-dimmed schema. */
  const ISSUE_STROKE = "#f59e0b";
  /** Arrowhead size in screen pixels, before the zoom counter-scale. */
  const ARROW_LENGTH = 9;
  const ARROW_HALF_WIDTH = 5;
</script>

<script lang="ts">
  import type { EdgeProps } from "@xyflow/svelte";
  import { polylinePath, splitPolylineAtMidpoint } from "@/features/editor/edges/pathMath";
  import { useEdgeRouting } from "@/features/editor/edges/edgeRouting.svelte";
  import { CARDINALITY_STYLE, type RefEdgeType } from "@/features/editor/edges/refEdgeTypes";
  import { getCanvasContext } from "@/features/editor/canvas/canvasContext";
  import { ENDPOINT_CARDINALITY } from "./EdgeCardinalityLabels.svelte";
  import RefEdgeOverlay from "./RefEdgeOverlay.svelte";

  /**
   * One relation on the canvas: a dimmed baseline stroke, an animated dashed
   * overlay while highlighted, a hand-drawn arrowhead, a fat invisible hit
   * stroke, and — only while it has something to show — the cardinality
   * chips, waypoint dots, midpoint toolbar and context menu in the flow's
   * edge-label layer.
   *
   * A schema can have a few hundred (or few thousand) of these. No memo
   * comparator is needed: the edge overlay in `canvasEdges` hands back the
   * same `data` object for every ref whose highlight didn't change, and a
   * Svelte component only re-evaluates the expressions reading what did.
   */
  let {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected = false,
  }: EdgeProps<RefEdgeType> = $props();

  const canvas = getCanvasContext();
  let isHovered = $state(false);

  const cardinality = $derived(data?.cardinality ?? "one-to-many");
  const style = $derived(CARDINALITY_STYLE[cardinality]);
  const isManyToMany = $derived(cardinality === "many-to-many");

  const routing = useEdgeRouting({
    edgeId: () => id,
    sourceX: () => sourceX,
    sourceY: () => sourceY,
    targetX: () => targetX,
    targetY: () => targetY,
    sourcePosition: () => sourcePosition,
    targetPosition: () => targetPosition,
    routingPoints: () => data?.routingPoints,
    onRoutingPointsChange: (points) => data?.onRoutingPointsChange(points),
  });

  // Pure geometry, so it costs nothing for the edges that never use it and
  // never lands a frame behind the line the way measuring the rendered
  // `<path>` did.
  const split = $derived(splitPolylineAtMidpoint(routing.drawnPoints));
  const labelX = $derived(split?.mid.x ?? routing.stepLabelX);
  const labelY = $derived(split?.mid.y ?? routing.stepLabelY);

  const isHighlighted = $derived(Boolean(data?.highlightLinks || data?.connectedHighlight || selected || isHovered));
  const hasIssue = $derived(Boolean(data?.hasIssue));
  const strokeColor = $derived(hasIssue ? ISSUE_STROKE : isHighlighted ? (data?.color ?? style.stroke) : DIMMED_STROKE);
  // Path coordinates live in flow space, which the viewport scales down via a
  // CSS transform as the user zooms out — so a fixed stroke-width/dasharray
  // shrinks to sub-pixel and disappears at low zoom. Dividing by zoom here
  // pre-compensates in flow units so the *rendered* size on screen stays
  // constant regardless of zoom level.
  const zoom = $derived(canvas.zoom);
  const zoomCompensation = $derived(1 / Math.max(zoom, 0.01));
  const strokeWidth = $derived((selected ? 2.5 : isHighlighted ? 2 : 1.5) * zoomCompensation);
  const strokeOpacity = $derived(selected ? 1 : isHighlighted ? 0.95 : hasIssue ? 0.85 : 0.45);

  // Rectangular dashes (dbdiagram style) with clean, well-spaced flow:
  // 8px dash, 10px gap in screen pixels (compensated for zoom)
  const dash = $derived(8 * zoomCompensation);
  const gap = $derived(10 * zoomCompensation);
  const period = $derived(-(dash + gap));
  const flowAnimation = $derived(isHighlighted ? `ref-edge-flow ${selected ? 0.6 : 0.9}s linear infinite` : "none");

  const baseStrokeStyle = $derived(
    `stroke: ${strokeColor}; stroke-width: ${1.5 * zoomCompensation}; opacity: ${isHighlighted ? 0.3 : strokeOpacity}; stroke-linecap: round;`,
  );
  const animatedStrokeStyle = $derived(
    `stroke: ${strokeColor}; stroke-width: ${strokeWidth}; opacity: ${strokeOpacity}; stroke-dasharray: ${dash} ${gap}; stroke-linecap: butt; animation: ${flowAnimation}; --dash-period: ${period}px;`,
  );

  /**
   * Arrowhead drawn as part of the edge instead of an SVG `marker-end`.
   *
   * A marker is defined once, up front, with a fixed colour, and the flow
   * sizes it in `strokeWidth` units — so it stayed the relation's bright
   * colour on a dimmed line and doubled in size the moment the edge was
   * selected. Drawing it here keeps colour, opacity and size in step with the
   * stroke it belongs to.
   */
  const arrow = $derived.by(() => {
    const points = routing.drawnPoints;
    if (points.length < 2) return null;
    const tip = points[points.length - 1];
    const previous = points[points.length - 2];
    if (tip.x === previous.x && tip.y === previous.y) return null;
    const angle = (Math.atan2(tip.y - previous.y, tip.x - previous.x) * 180) / Math.PI;
    const length = ARROW_LENGTH * zoomCompensation;
    const halfWidth = ARROW_HALF_WIDTH * zoomCompensation;
    return {
      points: `0,0 ${-length},${-halfWidth} ${-length},${halfWidth}`,
      transform: `translate(${tip.x} ${tip.y}) rotate(${angle})`,
    };
  });

  // Editing controls show while the edge is selected or hovered.
  // `routing.isDraggingPoint` keeps this true even if hover flickers off
  // mid-drag — the waypoint dot is portaled elsewhere in the DOM (not a
  // descendant of the edge's own hit-stroke), so the moment the cursor
  // crosses onto the dot itself the browser fires `mouseleave` on the stroke
  // underneath.
  const showEditingControls = $derived(Boolean(selected || isHovered || routing.isDraggingPoint));
  const endpointLabels = $derived(ENDPOINT_CARDINALITY[cardinality]);

  const hover = () => (isHovered = true);
</script>

{#if isManyToMany && split}
  <!-- Split in two so each half animates on its own; both halves still run
       source → target, which is what keeps the dash flow and the arrowhead
       pointing the same way as every other cardinality. -->
  <path d={polylinePath(split.first)} fill="none" style={baseStrokeStyle} role="presentation" onmouseenter={hover} />
  <path d={polylinePath(split.second)} fill="none" style={baseStrokeStyle} role="presentation" onmouseenter={hover} />
  {#if isHighlighted}
    <path
      d={polylinePath(split.first)}
      fill="none"
      class="ref-edge-flow-path"
      style={animatedStrokeStyle}
      role="presentation"
      onmouseenter={hover}
    />
    <path
      d={polylinePath(split.second)}
      fill="none"
      class="ref-edge-flow-path"
      style={animatedStrokeStyle}
      role="presentation"
      onmouseenter={hover}
    />
  {/if}
{:else}
  <path d={routing.fullPath} fill="none" style={baseStrokeStyle} role="presentation" onmouseenter={hover} />
  {#if isHighlighted}
    <path
      d={routing.fullPath}
      fill="none"
      class="ref-edge-flow-path"
      style={animatedStrokeStyle}
      role="presentation"
      onmouseenter={hover}
    />
  {/if}
{/if}
{#if arrow}
  <polygon
    points={arrow.points}
    fill={strokeColor}
    opacity={strokeOpacity}
    transform={arrow.transform}
    style="pointer-events: none"
  />
{/if}
<!-- Generous invisible fat stroke (24px) carrying all pointer & hover
     interactions. No `cursor: pointer` here on purpose: at 24px wide, this hit
     area crosses large swaths of empty-looking canvas on any schema with more
     than a handful of refs — the cursor would flip to "clickable" constantly
     while just moving the mouse around, with nothing to click there most of
     the time. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<path
  d={routing.fullPath}
  fill="none"
  stroke="rgba(0, 0, 0, 0.001)"
  stroke-width={24 * zoomCompensation}
  stroke-linecap="round"
  class="svelte-flow__edge-interaction"
  style="pointer-events: stroke"
  onmouseenter={hover}
  onmouseleave={() => {
    isHovered = false;
    routing.handlePathMouseLeave();
  }}
  onmousemove={routing.handlePathMouseMove}
  onclick={(e) => {
    // Selection is ours alone (`selectedEdgeId` in `ProjectEditor`, fed back
    // in through the one-way `edges` prop) — never Svelte Flow's own
    // click-to-select. Left to bubble, this click also reaches the flow's
    // own `<g>` wrapper (which runs its own, entirely redundant
    // `handleEdgeSelection`) and then the pane's own click handler, which
    // unconditionally deselects everything (`store.unselectNodesAndEdges()`,
    // with no `event.target` check) — racing our reactive update and
    // sometimes winning, which is what let a relation stay highlighted (or
    // fail to re-highlight) after this same click should have settled it.
    e.stopPropagation();
    const candidate = routing.candidatePoint;
    if (candidate) {
      routing.insertPointAt(candidate);
    } else {
      data?.onSelectEdge?.(id);
    }
  }}
  ondblclick={routing.handlePathDoubleClick}
  oncontextmenu={(event) => routing.openContextMenu(event)}
>
  {#if hasIssue && data?.issueMessages}<title>{data.issueMessages.join("\n")}</title>{/if}
</path>
<!-- Mounted only when it would hold something: an idle relation keeps no
     portal (and no subscription) alive for an empty subtree, several hundred
     times over on a large schema.

     A separate component rather than an inline `<div use:portal>` here — see
     `RefEdgeOverlay.svelte`'s own header comment for why: a literal HTML tag
     at this level pushed the whole shared template (including the SVG
     `<path>`s above) into the HTML namespace. -->
{#if isHighlighted || showEditingControls || routing.contextMenu}
  <RefEdgeOverlay
    {sourceX}
    {sourceY}
    {targetX}
    {targetY}
    {labelX}
    {labelY}
    {selected}
    {zoom}
    {strokeColor}
    {style}
    {data}
    {routing}
    {isHighlighted}
    {showEditingControls}
    {endpointLabels}
  />
{/if}
