<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The explanatory paragraph at the top of a page: what it is for, in a
   * reading width that does not stretch with the page. One of the page
   * building blocks with `PageToolbar` — a page that writes its own
   * `<p class="max-w-…">` drifts from the others.
   */
  let { children }: { children: Snippet } = $props();
</script>

<p class="m-0 mb-4 max-w-[680px] text-label leading-relaxed text-text-muted">{@render children()}</p>
