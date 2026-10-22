<script lang="ts">
  /**
   * A thin progress bar for work the user is waiting on: opening a big project, and later a deployment.
   * `value` is 0 to 100; `null` is "working, no idea how far", an indeterminate sweep. The caller decides
   * when to show it (see `useDelayedFlag`): a bar that flashes for a quarter of a second is noise.
   */
  let {
    value = null,
    label,
    class: className = "",
  }: {
    value?: number | null;
    /** What is happening, for assistive technology. */
    label: string;
    class?: string;
  } = $props();

  const clamped = $derived(value === null ? null : Math.max(0, Math.min(100, value)));
</script>

<div
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={clamped === null ? undefined : Math.round(clamped)}
  class={`h-0.5 w-full overflow-hidden bg-primary-light ${className}`.trim()}
>
  {#if clamped === null}
    <div class="sweep h-full w-1/3 bg-primary"></div>
  {:else}
    <div class="h-full bg-primary transition-[width] duration-200 ease-out" style:width={`${clamped}%`}></div>
  {/if}
</div>

<style>
  .sweep {
    animation: progress-sweep 1.2s ease-in-out infinite;
  }
  @keyframes progress-sweep {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(300%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sweep {
      animation: none;
    }
  }
</style>
