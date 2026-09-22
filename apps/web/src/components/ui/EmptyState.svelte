<script lang="ts">
  import type { Snippet } from "svelte";

  /** Dashed placeholder shown instead of a list/grid when there's nothing to show yet. */
  let { children }: { children: Snippet } = $props();
</script>

<div class="rounded-md border border-dashed border-border px-4 py-8 text-center text-[13px] text-text-muted">
  {@render children()}
</div>
