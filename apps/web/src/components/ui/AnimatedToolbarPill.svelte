<script lang="ts" module>
  /**
   * Last natural width measured per pill, keyed by `pillId` — module-level and
   * deliberately not component state: it has to survive the full unmount/remount
   * an MLD/MCD switch causes (a fresh component instance every time), and it's
   * purely an animation starting point, never read for layout decisions.
   */
  const lastWidths = new Map<string, number>();

  /** A bit past the CSS transition's own 200ms, so it always fires after any real animation has finished settling. */
  const RELEASE_DELAY_MS = 260;
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { untrack } from "svelte";
  import { CANVAS_TOOLBAR_CLASS } from "./canvasToolbarStyles";

    /**
     * The `CANVAS_TOOLBAR_CLASS` pill whose width morphs from its last measured width to its new
     * natural width (FLIP), so an MLD/MCD toolbar swap grows or shrinks instead of jump-cutting.
     * The cache is written on mount and the fixed width released on a timeout, not on
     * `transitionend`, which may never fire.
     */
  let { pillId, class: className = "", children }: { pillId: string; class?: string; children: Snippet } = $props();

  let element: HTMLDivElement;
  let width = $state<number | undefined>(untrack(() => lastWidths.get(pillId)));

  $effect(() => {
    const id = pillId;
    const target = element.scrollWidth;
    lastWidths.set(id, target);

    const raf = requestAnimationFrame(() => {
      width = target;
    });
    const release = setTimeout(() => {
      width = undefined;
    }, RELEASE_DELAY_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(release);
    };
  });
</script>

<div
  bind:this={element}
  class={`${CANVAS_TOOLBAR_CLASS} overflow-hidden transition-[width] duration-200 ease-out ${className}`}
  style:width={width !== undefined ? `${width}px` : undefined}
>
  {@render children()}
</div>
