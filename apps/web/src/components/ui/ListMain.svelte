<script lang="ts">
  import type { Snippet } from "svelte";

  /** The row's primary label/content cluster — flexes to fill the row, leaving action buttons at fixed width. */
  let { children, as = "div", onclick }: { children: Snippet; as?: "div" | "button"; onclick?: () => void } =
    $props();

  const className = "flex min-w-0 flex-1 items-center gap-2 text-[13px]";
</script>

{#if as === "button"}
  <button class={`${className} cursor-pointer border-none bg-none p-0 text-left text-text`} {onclick}>
    {@render children()}
  </button>
{:else}
  <div class={className}>{@render children()}</div>
{/if}
