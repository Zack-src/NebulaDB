<script lang="ts" module>
  import type { DetailLevel } from "@athanordb/shared";
  import type { TranslationKeyOf } from "@/types";

  const DETAIL_LEVELS = ["compact", "standard", "full"] as const;

  const LABEL_KEY = {
    compact: "canvas.detail.compact",
    standard: "canvas.detail.standard",
    full: "canvas.detail.full",
  } as const satisfies Record<DetailLevel, TranslationKeyOf>;

  const HINT_KEY = {
    compact: "canvas.detail.compactHint",
    standard: "canvas.detail.standardHint",
    full: "canvas.detail.fullHint",
  } as const satisfies Record<DetailLevel, TranslationKeyOf>;
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon } from "@/components/icons/Icons";
  import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
  import { CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS, CANVAS_TOOLBAR_SEGMENT_CLASS } from "@/components/ui/canvasToolbarStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import ToolbarMenu from "./ToolbarMenu.svelte";

  /**
   * Detail-level control — a single button opening a popover list instead of
   * three always-visible segments, so the floating toolbar stays compact.
   */
  let { value, onChange }: { value: DetailLevel | null; onChange: (level: DetailLevel) => void } = $props();

  const { t } = useTranslation();
</script>

<ToolbarMenu
  tooltip={t("canvas.detail.tooltip")}
  triggerClassName={(open) => `${CANVAS_TOOLBAR_SEGMENT_CLASS} ${open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
>
  {#snippet triggerContent()}
    {value ? t(LABEL_KEY[value]) : t("canvas.detail.label")}
    <Icon icon={ChevronRightIcon} size={12} class="-rotate-90" />
  {/snippet}
  {#snippet children(close)}
    {#each DETAIL_LEVELS as level (level)}
      <button
        type="button"
        class={`${CONTEXT_MENU_ITEM_CLASS} justify-between ${level === value ? "text-text" : ""}`}
        onclick={() => {
          onChange(level);
          close();
        }}
        data-tooltip={t(HINT_KEY[level])}
      >
        {t(LABEL_KEY[level])}
        {#if level === value}<span class="text-primary">✓</span>{/if}
      </button>
    {/each}
  {/snippet}
</ToolbarMenu>
