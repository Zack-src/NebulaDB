<script lang="ts">
  import type { RefAction, RefCardinality } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { RestoreIcon, SettingsIcon } from "@/components/icons/Icons";
  import { EDGE_CHROME_Z } from "@/features/editor/edges/canvasLayers";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import EdgeSettingsPopover from "./EdgeSettingsPopover.svelte";

  const ROUND_BTN_CLASS =
    "flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full " +
    "text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text";

  let props: {
    x: number;
    y: number;
    label: string;
    cardinality: RefCardinality;
    onCardinalityChange?: (cardinality: RefCardinality) => void;
    onDelete?: RefAction;
    onUpdate?: RefAction;
    onDeleteActionChange?: (action: RefAction | undefined) => void;
    onUpdateActionChange?: (action: RefAction | undefined) => void;
    onReverseDirection?: () => void;
    color: string;
    zoom: number;
    palette: string[];
    onPaletteChange: (palette: string[]) => void;
    onColorChange: (color: string | undefined) => void;
    showReset: boolean;
    onReset: () => void;
    onDeleteRef?: () => void;
    onContextMenu: (e: MouseEvent) => void;
  } = $props();

  const { t } = useTranslation();
  const scale = $derived(1 / Math.max(props.zoom, 0.01));
  let popoverOpen = $state(false);
  let triggerRect = $state.raw<DOMRect | null>(null);
  let badge: HTMLDivElement | undefined = $state();

  function togglePopover(e: MouseEvent) {
    e.stopPropagation();
    if (badge) triggerRect = badge.getBoundingClientRect();
    popoverOpen = !popoverOpen;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={badge}
  class="nodrag nopan absolute flex items-center gap-0.5 rounded-full border border-border-strong bg-surface-raised p-[3px] pl-2 shadow-md hover:border-primary/50"
  style:left="0"
  style:top="0"
  style:transform="translate({props.x}px, {props.y}px) translate(-50%, -50%) scale({scale})"
  style:transform-origin="center center"
  style:pointer-events="auto"
  style:z-index={EDGE_CHROME_Z}
  oncontextmenu={props.onContextMenu}
>
  <button
    type="button"
    onclick={togglePopover}
    class="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] font-bold leading-none tracking-[0.02em] hover:bg-surface-hover"
    style:color={props.color}
    data-tooltip={t("edge.settings")}
  >
    <span>{props.label}</span>
  </button>

  <span class="mr-0.5 h-3.5 w-px shrink-0 bg-border"></span>

  {#if props.showReset}
    <button
      type="button"
      class={ROUND_BTN_CLASS}
      onclick={(e) => {
        e.stopPropagation();
        props.onReset();
      }}
      data-tooltip={t("edge.resetPath")}
      aria-label={t("edge.resetPath")}
    >
      <Icon icon={RestoreIcon} size={12} />
    </button>
  {/if}

  <button
    type="button"
    class={`${ROUND_BTN_CLASS}${popoverOpen ? " bg-surface-hover text-text" : ""}`}
    onclick={togglePopover}
    data-tooltip={t("edge.settings")}
    aria-label={t("edge.settings")}
  >
    <Icon icon={SettingsIcon} size={12} />
  </button>
</div>

{#if popoverOpen && triggerRect}
  <EdgeSettingsPopover
    cardinality={props.cardinality}
    onCardinalityChange={props.onCardinalityChange}
    onDelete={props.onDelete}
    onUpdate={props.onUpdate}
    onDeleteActionChange={props.onDeleteActionChange}
    onUpdateActionChange={props.onUpdateActionChange}
    onReverseDirection={props.onReverseDirection}
    color={props.color}
    onColorChange={props.onColorChange}
    palette={props.palette}
    onPaletteChange={props.onPaletteChange}
    onResetRouting={props.onReset}
    onDeleteRef={props.onDeleteRef}
    {triggerRect}
    onClose={() => (popoverOpen = false)}
  />
{/if}
