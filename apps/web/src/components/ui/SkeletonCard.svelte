<script lang="ts">
  import Skeleton from "./Skeleton.svelte";

  /** A card-shaped placeholder matching `ProjectCard`'s footprint, so the grid doesn't jump when real data lands. */
</script>

<div aria-hidden="true" class="rounded-xl border border-border/60 bg-surface/60 p-3">
  <Skeleton class="mb-3 h-[104px] w-full" />
  <Skeleton class="mb-2 h-3.5 w-3/4" />
  <Skeleton class="h-3 w-1/3" />
</div>
