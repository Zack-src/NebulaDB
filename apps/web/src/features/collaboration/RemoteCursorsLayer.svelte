<script lang="ts">
  import { ViewportPortal, useStore } from "@xyflow/svelte";
  import type { Awareness } from "y-protocols/awareness.js";
  import { useAwarenessStates } from "@/features/collaboration/awarenessStates.svelte";

  /**
   * Renders every other participant's live cursor directly into the flow's
   * viewport-portal layer, instead of as an entry in the `nodes` array.
   *
   * Cursors used to be plain canvas nodes so they'd inherit pan/zoom "for
   * free". That looked free, but wasn't: a remote peer's mouse move fires tens
   * of times a second, and every one of them pushed a brand-new `nodes` array
   * through the flow's node reconciliation — which walks *every* node on the
   * canvas, not just the cursor.
   *
   * `ViewportPortal` renders into the layer the flow keeps pinned to the
   * current pan/zoom, so cursors inherit that same free pan/zoom, but a cursor
   * moving only ever updates this one small subtree — never the tables, edges,
   * or anything else on the canvas.
   *
   * Mounted once, isolated from the rest of the tree: `awareness` is read here
   * rather than threaded down as an already-derived prop, so a cursor moving
   * doesn't also touch `ProjectEditor`/`CanvasArea` on its way here.
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
