<script lang="ts">
  import type { RefAction, RefCardinality } from "@athanordb/shared";
  import { anchoredPlacement, provisionalPopoverStyle } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, RestoreIcon, SwapHorizontalIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ColorSwatchPicker from "@/components/inputs/ColorSwatchPicker.svelte";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import { ACTION_SELECT_CLASS, REF_ACTIONS, REF_ACTION_LABEL_KEY } from "./refActionOptions";
  import { EDGE_MENU_ATTRIBUTE } from "./edgeRouting.svelte";

  let {
    cardinality,
    onCardinalityChange,
    onDelete,
    onUpdate,
    onDeleteActionChange,
    onUpdateActionChange,
    color,
    onColorChange,
    palette,
    onPaletteChange,
    onResetRouting,
    onReverseDirection,
    onDeleteRef,
    triggerRect,
    onClose,
  }: {
    cardinality: RefCardinality;
    onCardinalityChange?: (cardinality: RefCardinality) => void;
    onDelete?: RefAction;
    onUpdate?: RefAction;
    onDeleteActionChange?: (action: RefAction | undefined) => void;
    onUpdateActionChange?: (action: RefAction | undefined) => void;
    color?: string;
    onColorChange: (color: string | undefined) => void;
    palette: string[];
    onPaletteChange: (palette: string[]) => void;
    onResetRouting: () => void;
    onReverseDirection?: () => void;
    onDeleteRef?: () => void;
    triggerRect: DOMRect;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let popover: HTMLDivElement | undefined = $state();

  useDismissablePopover(
    () => true,
    () => onClose(),
    () => [popover],
  );

  const CARDINALITY_OPTIONS: {
    value: RefCardinality;
    labelKey: TranslationKeyOf;
    descKey: TranslationKeyOf;
    notation: string;
    notationClass: string;
  }[] = [
    {
      value: "one-to-many",
      labelKey: "edge.cardinality.oneToMany",
      descKey: "edge.cardinality.oneToManyDesc",
      notation: "1 : *",
      notationClass: "text-primary",
    },
    {
      value: "one-to-one",
      labelKey: "edge.cardinality.oneToOne",
      descKey: "edge.cardinality.oneToOneDesc",
      notation: "1 : 1",
      notationClass: "text-[#818cf8]",
    },
    {
      value: "many-to-many",
      labelKey: "edge.cardinality.manyToMany",
      descKey: "edge.cardinality.manyToManyDesc",
      notation: "* : *",
      notationClass: "text-[#fbbf24]",
    },
  ];

  const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-text-muted";
</script>

<div
  use:portal
  use:anchoredPlacement={{ rect: triggerRect }}
  bind:this={popover}
  {...{ [EDGE_MENU_ATTRIBUTE]: "" }}
  class="fixed z-[var(--z-popover)] flex w-[320px] flex-col gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 shadow-xl nodrag nopan"
  style={provisionalPopoverStyle(triggerRect)}
  onclick={(event) => event.stopPropagation()}
  onmousedown={(event) => event.stopPropagation()}
>
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-border pb-2">
    <div class="flex items-center gap-2">
      <span class="h-3 w-3 rounded-full border border-white/20" style:background-color={color ?? "#818cf8"}></span>
      <span class="text-xs font-semibold text-text">{t("edge.settingsTitle")}</span>
    </div>
    <button
      type="button"
      onclick={onClose}
      class="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
      aria-label={t("common.close")}
    >
      <Icon icon={CloseIcon} size={12} />
    </button>
  </div>

  <!-- Cardinality, with a plain-language explanation of each option -->
  <div class="flex flex-col gap-2">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={SECTION_LABEL}>{t("edge.cardinality")}</label>
    <div class="flex flex-col gap-1.5">
      {#each CARDINALITY_OPTIONS as option (option.value)}
        <button
          type="button"
          disabled={!onCardinalityChange}
          onclick={() => onCardinalityChange?.(option.value)}
          class={`flex flex-col items-start gap-1 rounded-md border p-2 text-left transition-all ${
            cardinality === option.value
              ? "border-primary bg-primary-light/30 ring-1 ring-primary"
              : "border-border bg-surface hover:bg-surface-hover"
          }`}
        >
          <div class="flex w-full items-center justify-between">
            <span class="text-xs font-semibold text-text">{t(option.labelKey)}</span>
            <span class={`rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] ${option.notationClass}`}>
              {option.notation}
            </span>
          </div>
          <p class="text-[11px] leading-snug text-text-secondary">{t(option.descKey)}</p>
        </button>
      {/each}
    </div>
  </div>

  <!-- Referential actions (ON DELETE / ON UPDATE) -->
  <div class="grid grid-cols-2 gap-2 border-t border-border pt-2.5">
    <div class="flex flex-col gap-1">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={SECTION_LABEL}>{t("edge.onDelete")}</label>
      <select
        class={ACTION_SELECT_CLASS}
        value={onDelete ?? ""}
        disabled={!onDeleteActionChange}
        onchange={(e) => onDeleteActionChange?.((e.currentTarget.value || undefined) as RefAction | undefined)}
      >
        <option value="">{t("edge.action.default")}</option>
        {#each REF_ACTIONS as action (action)}
          <option value={action}>{t(REF_ACTION_LABEL_KEY[action])}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col gap-1">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={SECTION_LABEL}>{t("edge.onUpdate")}</label>
      <select
        class={ACTION_SELECT_CLASS}
        value={onUpdate ?? ""}
        disabled={!onUpdateActionChange}
        onchange={(e) => onUpdateActionChange?.((e.currentTarget.value || undefined) as RefAction | undefined)}
      >
        <option value="">{t("edge.action.default")}</option>
        {#each REF_ACTIONS as action (action)}
          <option value={action}>{t(REF_ACTION_LABEL_KEY[action])}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Relation colour -->
  <div class="flex flex-col gap-2 border-t border-border pt-2.5">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={SECTION_LABEL}>{t("edge.color")}</label>
    <div class="flex items-center gap-2">
      <ColorSwatchPicker
        value={color ?? "#818cf8"}
        onChange={onColorChange}
        {palette}
        {onPaletteChange}
        triggerClassName="h-6 w-6 shrink-0 cursor-pointer rounded-full border border-white/30"
      />
      {#if color}
        <Button variant="ghost" size="sm" onclick={() => onColorChange(undefined)} class="text-xs">
          {t("edge.resetColor")}
        </Button>
      {/if}
    </div>
  </div>

  <!-- Actions -->
  <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
    <div class="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => {
          onResetRouting();
          onClose();
        }}
        class="text-xs text-text-secondary hover:text-text"
      >
        <Icon icon={RestoreIcon} size={12} />
        <span>{t("edge.resetPathShort")}</span>
      </Button>
      {#if onReverseDirection}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => {
            onReverseDirection?.();
            onClose();
          }}
          class="text-xs text-text-secondary hover:text-text"
          data-tooltip={t("edge.reverseDirectionHint")}
        >
          <Icon icon={SwapHorizontalIcon} size={12} />
          <span>{t("edge.reverseDirection")}</span>
        </Button>
      {/if}
    </div>
    {#if onDeleteRef}
      <Button
        variant="danger"
        size="sm"
        onclick={() => {
          onDeleteRef?.();
          onClose();
        }}
        class="text-xs"
      >
        <Icon icon={TrashIcon} size={12} />
        <span>{t("common.delete")}</span>
      </Button>
    {/if}
  </div>
</div>
