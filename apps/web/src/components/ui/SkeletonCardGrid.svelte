<script lang="ts">
  import SkeletonCard from "./SkeletonCard.svelte";

  /** `count` card placeholders in the same grid the real cards use. */
  let { count = 4 }: { count?: number } = $props();
</script>

<div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
  {#each { length: count }, index (index)}
    <SkeletonCard />
  {/each}
</div>
