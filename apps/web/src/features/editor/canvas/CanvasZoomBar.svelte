<script lang="ts" module>
  const ZOOM_PRESETS = [0.5, 1, 2] as const;
  /** Key combination, not prose — never translated. */
  const FIT_SHORTCUT = "Shift+1";
  const FIT_PADDING = 0.15;
  const FIT_SELECTION_PADDING = 0.3;
  const ZOOM_STEP_DURATION_MS = 120;
  const ZOOM_FIT_DURATION_MS = 200;
</script>

<script lang="ts">
  import { useStore, useSvelteFlow } from "@xyflow/svelte";
  import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
  import {
    CANVAS_TOOLBAR_CLASS,
    CANVAS_TOOLBAR_DIVIDER_CLASS,
    CANVAS_TOOLBAR_ICON_BTN_CLASS,
    CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS,
    CANVAS_TOOLBAR_SEGMENT_CLASS,
  } from "@/components/ui/canvasToolbarStyles";
  import Icon from "@/components/icons/Icon.svelte";
  import { LayoutGridIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import ToolbarMenu from "./ToolbarMenu.svelte";

  /**
   * Zoom pill, bottom-left: −, a percentage button opening fit/preset choices, +,
   * then a one-click fit. Kept apart from the editing toolbar the way dbdiagram
   * separates them — viewport control is a different gesture from editing, and
   * pinning it to a corner means it doesn't move as the toolbar grows.
   */
  let { selectedIds }: { selectedIds: string[] } = $props();

  const { t } = useTranslation();
  const { zoomIn, zoomOut, setZoom, fitView } = useSvelteFlow();
  const store = useStore();
  const zoomPercent = $derived(Math.round(store.viewport.zoom * 100));

  const fitAll = () => fitView({ padding: FIT_PADDING, duration: ZOOM_FIT_DURATION_MS });
</script>

<div class={CANVAS_TOOLBAR_CLASS}>
  <button
    type="button"
    class={CANVAS_TOOLBAR_ICON_BTN_CLASS}
    onclick={() => zoomOut({ duration: ZOOM_STEP_DURATION_MS })}
    data-tooltip={t("canvas.zoom.out")}
    data-tooltip-pos="top"
    aria-label={t("canvas.zoom.out")}
  >
    <span class="text-[17px] leading-none">−</span>
  </button>
  <ToolbarMenu
    tooltip={t("canvas.zoom.label")}
    minWidth={190}
    triggerClassName={(open) =>
      `${CANVAS_TOOLBAR_SEGMENT_CLASS} min-w-[58px] justify-center tabular-nums ${open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
  >
    {#snippet triggerContent()}{zoomPercent}%{/snippet}
    {#snippet children(close)}
      <button
        type="button"
        class={`${CONTEXT_MENU_ITEM_CLASS} justify-between`}
        onclick={() => {
          fitAll();
          close();
        }}
      >
        {t("canvas.zoom.toFit")} <span class="text-text-muted">{FIT_SHORTCUT}</span>
      </button>
      <button
        type="button"
        class={`${CONTEXT_MENU_ITEM_CLASS} justify-between disabled:opacity-40`}
        disabled={selectedIds.length === 0}
        onclick={() => {
          fitView({
            padding: FIT_SELECTION_PADDING,
            duration: ZOOM_FIT_DURATION_MS,
            nodes: selectedIds.map((id) => ({ id })),
          });
          close();
        }}
      >
        {t("canvas.zoom.toSelection")}
      </button>
      {#each ZOOM_PRESETS as preset (preset)}
        <button
          type="button"
          class={CONTEXT_MENU_ITEM_CLASS}
          onclick={() => {
            setZoom(preset, { duration: ZOOM_FIT_DURATION_MS });
            close();
          }}
        >
          {preset * 100}%
        </button>
      {/each}
    {/snippet}
  </ToolbarMenu>
  <button
    type="button"
    class={CANVAS_TOOLBAR_ICON_BTN_CLASS}
    onclick={() => zoomIn({ duration: ZOOM_STEP_DURATION_MS })}
    data-tooltip={t("canvas.zoom.in")}
    data-tooltip-pos="top"
    aria-label={t("canvas.zoom.in")}
  >
    <span class="text-[17px] leading-none">+</span>
  </button>

  <span class={CANVAS_TOOLBAR_DIVIDER_CLASS}></span>
  <button
    type="button"
    class={CANVAS_TOOLBAR_ICON_BTN_CLASS}
    onclick={fitAll}
    data-tooltip={t("canvas.zoom.toFit")}
    data-tooltip-pos="top"
    aria-label={t("canvas.zoom.toFit")}
  >
    <Icon icon={LayoutGridIcon} size={16} />
  </button>
</div>
