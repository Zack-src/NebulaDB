<script lang="ts">
  import Skeleton from "@/components/ui/Skeleton.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * What stands in for the editor while a deep-linked project is still being resolved: the same bars and
   * the same two panes, empty. Without it the page shows the project list for those first moments, a
   * screen the user did not ask for and that disappears as soon as the project is known.
   */
  const { t } = useTranslation();
  const CODE_LINES = ["w-1/2", "w-3/4", "w-1/3", "w-2/3", "w-2/5", "w-3/5", "w-1/3", "w-3/4", "w-1/2", "w-3/5", "w-2/5", "w-2/3"];
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-bg" role="status" aria-label={t("projects.opening")}>
  <div class="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
    <Skeleton class="h-6 w-6" />
    <Skeleton class="h-4 w-40" />
  </div>
  <div class="flex h-10 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
    <Skeleton class="h-4 w-16" />
    <Skeleton class="h-4 w-20" />
    <Skeleton class="h-4 w-16" />
  </div>
  <div class="flex min-h-0 flex-1">
    <div class="flex w-[35%] min-w-[240px] flex-col gap-2.5 border-r border-border bg-surface p-4">
      {#each CODE_LINES as width, index (index)}
        <Skeleton class={`h-3 ${width}`} />
      {/each}
    </div>
    <div class="flex-1 bg-[var(--color-bg-canvas)]"></div>
  </div>
</div>
