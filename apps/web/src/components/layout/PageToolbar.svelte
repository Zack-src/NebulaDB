<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The row above a list: a filter, a creation field or button, a counter.
   * Wraps on narrow widths; put `class="ml-auto"` on the child that should sit
   * at the far end.
   */
  let { children }: { children: Snippet } = $props();
</script>

<div class="mb-3 flex flex-wrap items-center gap-2">{@render children()}</div>
