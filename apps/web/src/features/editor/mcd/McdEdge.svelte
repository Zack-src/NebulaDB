<script lang="ts">
  import { BaseEdge, getSmoothStepPath, portal, type EdgeProps } from "@xyflow/svelte";
  import type { McdEdgeType } from "./mcdNodes";

  /**
   * One leg of a Merise association: a straight line with right-angle bends
   * (same `smoothstep`-family shape the MLD canvas's own ref lines use — a
   * free-curving bezier read as "unrelated to the rest of the app"), from an
   * entity to its association diamond, labelled with the Merise `min,max` pair
   * instead of a crow's foot.
   */
  let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<McdEdgeType> =
    $props();

  const step = $derived.by(() => {
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 0,
    });
    return { path, labelX, labelY };
  });
</script>

<!-- interactionWidth={0}: no invisible hit-path — these lines are purely
     informational (nothing to click), so the flow's default 20px hit area
     would only add a pointer cursor with nothing behind it. -->
<BaseEdge {id} path={step.path} interactionWidth={0} style="stroke: var(--color-border); stroke-width: 1.5" />
{#if data?.cardinality}
  <div
    use:portal={"edge-labels"}
    class="absolute rounded-full border border-primary-border bg-surface px-1.5 py-px font-mono text-[10.5px] font-semibold text-primary-hover"
    style:left="0"
    style:top="0"
    style:transform="translate(-50%, -50%) translate({step.labelX}px, {step.labelY}px)"
  >
    {data.cardinality}
  </div>
{/if}
