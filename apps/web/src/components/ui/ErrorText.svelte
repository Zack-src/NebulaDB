<script lang="ts">
  import type { Snippet } from "svelte";

  /** Inline error banner used under forms and in modals. */
  let { children }: { children: Snippet } = $props();
</script>

<div
  role="alert"
  class="mt-2.5 rounded-md border border-danger/35 bg-danger-light px-2.5 py-2 text-[12.5px] leading-normal text-danger"
>
  {@render children()}
</div>
