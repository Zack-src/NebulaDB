<script lang="ts" module>
  /** Cheap string hash — deterministic per project id, no crypto needed. */
  export function hashOfId(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
    return Math.abs(hash);
  }

  const THUMBNAIL_BLOCK_COUNT = 3;
</script>

<script lang="ts">
  /**
   * A small abstract "schema" thumbnail generated from the project id — a few
   * rounded blocks over the same dot grid the real canvas uses. There's no real
   * preview to render (no thumbnail pipeline), so every card getting an
   * identical folder icon would read as flatter/more generic than the actual
   * product; this at least makes each tile visually distinct and echoes the
   * canvas it opens into.
   */
  let { id, accent }: { id: string; accent: string } = $props();

  const blocks = $derived.by(() => {
    const hash = hashOfId(id);
    return Array.from({ length: THUMBNAIL_BLOCK_COUNT }, (_, index) => {
      const seed = hash >> (index * 6);
      return {
        width: 34 + (seed % 28),
        height: 16 + ((seed >> 3) % 14),
        left: 10 + ((seed >> 6) % 55),
        top: 10 + ((seed >> 9) % 45),
      };
    });
  });
</script>

<div
  class="relative h-[104px] w-full overflow-hidden bg-bg-canvas"
  style="background-image: radial-gradient(var(--color-border) 1px, transparent 1px); background-size: 12px 12px;"
>
  <div class="absolute inset-0" style:background={`radial-gradient(120px 80px at 20% 20%, ${accent}22, transparent)`}></div>
  {#each blocks as block, index (index)}
    <span
      class="absolute rounded-md border"
      style:left="{block.left}px"
      style:top="{block.top}px"
      style:width="{block.width}px"
      style:height="{block.height}px"
      style:background={`${accent}1f`}
      style:border-color={`${accent}55`}
    ></span>
  {/each}
</div>
