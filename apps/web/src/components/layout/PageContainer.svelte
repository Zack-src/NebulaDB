<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The content column of a top-level page. One width for the whole shell, so
   * moving between projects, databases and the admin console does not make
   * the content jump sideways.
   */
  let { children }: { children: Snippet } = $props();
</script>

<div class="mx-auto w-full max-w-[1200px]">{@render children()}</div>
