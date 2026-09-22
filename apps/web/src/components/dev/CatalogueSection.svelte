<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, description, children }: { title: string; description?: string; children: Snippet } = $props();
</script>

<section class="flex flex-col gap-3 border-b border-border pb-8">
  <div>
    <h2 class="text-sm font-bold text-text">{title}</h2>
    {#if description}<p class="mt-0.5 text-[12.5px] text-text-muted">{description}</p>{/if}
  </div>
  {@render children()}
</section>
