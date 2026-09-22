<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon } from "@/components/icons/Icons";
  import { getWaypointOrientation, type Point } from "@/features/editor/edges/pathMath";
  import { EDGE_CHROME_Z } from "@/features/editor/edges/canvasLayers";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Draggable dots on each of a ref's custom/default corner points,
   * plus a ghost candidate insertion point when hovering along the segment.
   */
  let {
    points,
    source,
    target,
    selectedIndex,
    strokeColor,
    zoom,
    candidatePoint,
    onStartDrag,
    onSelect,
    onContextMenu,
    onInsertCandidate,
  }: {
    points: Point[];
    source: Point;
    target: Point;
    selectedIndex: number | null;
    strokeColor: string;
    zoom: number;
    candidatePoint?: Point | null;
    onStartDrag: (index: number, e: MouseEvent) => void;
    onSelect: (index: number) => void;
    onContextMenu: (e: MouseEvent, index: number) => void;
    onInsertCandidate?: (p: Point) => void;
  } = $props();

  const { t } = useTranslation();
  const scale = $derived(1 / Math.max(zoom, 0.01));
</script>

<!-- Existing waypoint drag handles -->
{#each points as p, i (i)}
  {@const orientation = getWaypointOrientation(i, points, source, target)}
  {@const cursorClass =
    orientation === "ew-resize" ? "cursor-ew-resize" : orientation === "ns-resize" ? "cursor-ns-resize" : "cursor-move"}
  <!-- No `active:scale-125` here: Tailwind's `scale-*` utilities set the
       standalone CSS `scale` property, which composes *with* (not instead of)
       this element's own `transform` — the instant you press the mouse down,
       the huge `translate(flowX, flowY)` this dot already carries gets
       multiplied by that extra 1.25×, and the point visibly leaps away from
       the cursor before any drag math even runs. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class={`ref-edge-waypoint pointer-events-auto absolute h-3 w-3 rounded-full border-2 bg-surface shadow-xs nodrag nopan ${cursorClass}${
      i === selectedIndex ? " ring-2 ring-primary ring-offset-1 ring-offset-bg" : ""
    }`}
    style:left="0"
    style:top="0"
    style:transform="translate({p.x}px, {p.y}px) translate(-50%, -50%) scale({scale})"
    style:transform-origin="center center"
    style:border-color={strokeColor}
    style:z-index={EDGE_CHROME_Z}
    onmousedown={(event) => onStartDrag(i, event)}
    onclick={(event) => {
      event.stopPropagation();
      onSelect(i);
    }}
    oncontextmenu={(event) => onContextMenu(event, i)}
    data-tooltip={t("edge.waypointHint")}
  ></div>
{/each}

<!-- Ghost candidate point on hover between points -->
{#if candidatePoint && onInsertCandidate}
  <!-- Same reason as the waypoint dot above: no `hover:scale-125` — it would
       compose with this element's own large positional `translate`. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="pointer-events-auto absolute flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-primary bg-primary-light/90 text-primary shadow-md nodrag nopan"
    style:left="0"
    style:top="0"
    style:transform="translate({candidatePoint.x}px, {candidatePoint.y}px) translate(-50%, -50%) scale({scale})"
    style:transform-origin="center center"
    style:z-index={EDGE_CHROME_Z + 1}
    onclick={(e) => {
      e.stopPropagation();
      onInsertCandidate?.(candidatePoint!);
    }}
    data-tooltip={t("edge.addPoint")}
  >
    <Icon icon={PlusIcon} size={10} />
  </div>
{/if}
