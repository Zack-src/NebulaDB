<script lang="ts">
    /**
     * Placeholder blocks for first-load data: an empty array is also what a list holds before its
     * fetch resolves, and telling someone they have no projects is worse than a blank.
     * `aria-hidden`: the content that replaces it is the live region.
     */
  let { class: className = "" }: { class?: string } = $props();
</script>

<div aria-hidden="true" class={`animate-pulse-subtle rounded-md bg-surface-hover ${className}`}></div>
