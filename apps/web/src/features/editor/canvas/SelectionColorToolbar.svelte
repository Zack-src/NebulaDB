<script lang="ts">
  import { Panel } from "@xyflow/svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { LayersIcon } from "@/components/icons/Icons";
  import { SWATCH_CELL_CLASS } from "@/components/inputs/colorSwatches";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Floating swatch row shown above the canvas once 2+ tables are selected —
   * picking a colour applies it to every selected table's header at once, and
   * "group" bundles them into a named table group.
   */
  let {
    count,
    palette,
    onPick,
    onGroup,
  }: { count: number; palette: string[]; onPick: (color: string) => void; onGroup: () => void } = $props();

  const { t } = useTranslation();
</script>

<Panel position="top-center" class="nodrag nopan">
  <div class="flex flex-col items-start gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-2 shadow-lg">
    <div class="flex w-full items-center justify-between gap-3">
      <span class="whitespace-nowrap text-xs text-text-muted">{t("canvas.selection.tablesSelected", { count })}</span>
      <button
        type="button"
        class="flex items-center gap-1 whitespace-nowrap rounded-md border border-border-strong/80 px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary hover:border-primary/60 hover:text-text"
        onclick={onGroup}
        data-tooltip={t("canvas.selection.groupTooltip")}
      >
        <Icon icon={LayersIcon} size={12} />
        {t("canvas.selection.group")}
      </button>
    </div>
    <div class="grid grid-cols-10 gap-1.5">
      {#each palette as color (color)}
        <button
          type="button"
          class={SWATCH_CELL_CLASS}
          style:background={color}
          onclick={() => onPick(color)}
          data-tooltip={color}
          aria-label={color}
        ></button>
      {/each}
    </div>
  </div>
</Panel>
