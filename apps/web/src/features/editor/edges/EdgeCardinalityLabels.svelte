<script lang="ts" module>
  /** Screen-space geometry for the chips — converted to flow units at render time so zoom never changes what the user sees. */
  const ALONG = 18;
  const AWAY = 12;
  /** Below this the two chips (plus the midpoint toolbar) would collide, so the edge goes unlabelled rather than unreadable. */
  const MIN_PATH = 56;

  /** "one-to-many" -> ["1", "n"], etc. — dbdiagram's per-endpoint convention, as opposed to this app's own combined "1–n" pill at the midpoint. */
  export const ENDPOINT_CARDINALITY: Record<"one-to-one" | "one-to-many" | "many-to-many", [string, string]> = {
    "one-to-one": ["1", "1"],
    "one-to-many": ["1", "n"],
    "many-to-many": ["n", "n"],
  };
</script>

<script lang="ts">
  import { endpointLabelAnchor, polylineLength, type Point } from "@/features/editor/edges/pathMath";

  /**
   * The "1"/"n" markers at each end of a ref, dbdiagram-style — shown alongside
   * (not instead of) the midpoint pill, which is this app's own addition and
   * stays because it's also where the edge's colour/reset/settings controls live.
   *
   * Three things make them readable where a bare span was not:
   *  - they sit *beside* the line (perpendicular offset), not centred on it;
   *  - they're opaque chips, so a line crossing behind one doesn't run through
   *    the glyph the way it did through a text-shadow halo;
   *  - only the first ref at a given handle (slot 0, assigned in `canvasEdges`)
   *    draws that end's chip at all. Several refs sharing a column handle all
   *    mean the exact same thing there ("1" on that column, every time) —
   *    showing it once per ref used to stagger a run of identical "1"s down the
   *    table's edge instead of reporting the one fact once.
   *
   * Sizes are divided by zoom because the edge-label layer rides the viewport
   * transform: without it a chip is illegibly small zoomed out and absurd
   * zoomed in, while the stroke it annotates stays constant.
   */
  let {
    points,
    sourceLabel,
    targetLabel,
    sourceSlot,
    targetSlot,
    color,
    opacity,
    zoom,
  }: {
    points: Point[];
    sourceLabel: string;
    targetLabel: string;
    sourceSlot: number;
    targetSlot: number;
    color: string;
    opacity: number;
    zoom: number;
  } = $props();

  const scale = $derived(1 / Math.max(zoom, 0.01));
  const visible = $derived(points.length >= 2 && polylineLength(points) >= MIN_PATH * scale);
  const source = $derived(
    visible && sourceSlot === 0 ? endpointLabelAnchor(points, false, ALONG * scale, AWAY * scale) : null,
  );
  const target = $derived(
    visible && targetSlot === 0 ? endpointLabelAnchor(points, true, ALONG * scale, AWAY * scale) : null,
  );
</script>

{#snippet chip(point: Point, label: string)}
  <span
    class="ref-edge-cardinality"
    style:left="0"
    style:top="0"
    style:transform="translate({point.x}px, {point.y}px) translate(-50%, -50%) scale({scale})"
    style:transform-origin="center center"
    style:color
    style:border-color={color}
    style:opacity
  >
    {label}
  </span>
{/snippet}

{#if source}{@render chip(source, sourceLabel)}{/if}
{#if target}{@render chip(target, targetLabel)}{/if}
