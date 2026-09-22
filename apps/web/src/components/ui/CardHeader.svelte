<script lang="ts">
  import type { Snippet } from "svelte";

  let { children, class: className = "" }: { children: Snippet; class?: string } = $props();
</script>

<div class={`border-b border-border px-5 pb-4 pt-5 ${className}`.trim()}>{@render children()}</div>
