<script lang="ts">
  import { ViewportPortal, useStore } from "@xyflow/svelte";
  import type { Awareness } from "y-protocols/awareness.js";
  import { useAwarenessStates } from "@/features/collaboration/awarenessStates.svelte";

    /**
     * Renders every other participant's live cursor in the flow's viewport-portal layer rather
     * than as `nodes`: a peer's mouse move fires tens of times a second, and each would push a new
     * `nodes` array through the flow's reconciliation of every node. Here a moving cursor only
     * updates this subtree. `awareness` is read here, not threaded down, so it doesn't touch
     * `ProjectEditor`/`CanvasArea`.
     */
  let { awareness }: { awareness: Awareness | null } = $props();

  const remote = useAwarenessStates(() => awareness);
  const store = useStore();

  /**
   * The portal's subtree is scaled by the pan/zoom transform, so a cursor
   * drawn at a fixed pixel size would shrink/grow with the canvas zoom. Figma
   * keeps remote cursors at a constant screen size regardless of zoom; the
   * counter-scale (`1 / zoom`) on an inner wrapper does the same, while the
   * outer `translate` stays in world coordinates so the cursor tip lands on
   * the right canvas point.
   */
  const counterScale = $derived(1 / store.viewport.zoom);

  // Nobody else on the canvas: mount nothing — not even the portal.
  const cursors = $derived(Array.from(remote.states.entries()).filter(([, state]) => state.cursor));
</script>

{#if cursors.length > 0}
  <ViewportPortal target="front">
    {#each cursors as [clientId, state] (clientId)}
      <div
        style:position="absolute"
        style:transform="translate({state.cursor!.x}px, {state.cursor!.y}px)"
        style:transition="transform 100ms linear"
        style:pointer-events="none"
        style:z-index="1000"
      >
        <div style:transform="scale({counterScale})" style:transform-origin="top left">
          <svg width="18" height="18" viewBox="0 0 18 18" style="position: absolute; top: -1px; left: -1px">
            <path
              d="M1 1 L1 14.5 L5 11 L7.8 16.5 L10 15.4 L7.2 10 L13 10 Z"
              fill={state.user.color}
              stroke="white"
              stroke-width="1"
              stroke-linejoin="round"
            />
          </svg>
          <span
            class="absolute left-[15px] top-[15px] whitespace-nowrap rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
            style:background={state.user.color}
          >
            {state.user.name}
          </span>
        </div>
      </div>
    {/each}
  </ViewportPortal>
{/if}
