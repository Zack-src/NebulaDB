<script lang="ts">
  import type { Snippet } from "svelte";

  /** Muted explanatory paragraph used at the top of modal bodies. */
  let { children }: { children: Snippet } = $props();
</script>

<p class="mb-3 text-[12.5px] leading-normal text-text-muted">{@render children()}</p>
