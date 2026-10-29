<script lang="ts">
  /**
   * What a deployment step shows while the plan is being analysed, instead of a verdict it
   * cannot give yet: a step that read "no risk found" before the analysis had finished would
   * say something nobody checked.
   */
  let { title, detail }: { title: string; detail?: string } = $props();
</script>

<div
  role="status"
  aria-live="polite"
  class="flex flex-col items-center justify-center gap-2 rounded-sm border border-primary/30 bg-primary/10 p-8 text-center"
>
  <span
    class="size-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary motion-reduce:animate-none"
    aria-hidden="true"
  ></span>
  <p class="m-0 text-body font-semibold text-text">{title}</p>
  {#if detail}<p class="m-0 text-xs text-text-muted">{detail}</p>{/if}
</div>
