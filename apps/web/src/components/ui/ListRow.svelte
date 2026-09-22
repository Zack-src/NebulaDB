<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="flex items-center gap-2.5 rounded-sm border border-border bg-surface px-3 py-2.5">
  {@render children()}
</div>
