<script lang="ts">
  import { MAX_NAME_LENGTH, type Table, type TableIndex } from "@athanordb/shared";
  import { anchoredPlacement, provisionalPopoverStyle } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon } from "@/components/icons/Icons";
  import { SWATCH_CELL_ACTIVE_CLASS, SWATCH_CELL_CLASS, SWATCH_GRID_CLASS } from "@/components/inputs/colorSwatches";
  import { useCloseOnViewportChange } from "@/hooks/closeOnViewportChange.svelte";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    DEFAULT_HEADER_COLOR,
    POPOVER_GROUP_CLASS,
    POPOVER_HEADER_CLASS,
    POPOVER_INPUT_CLASS,
    POPOVER_LABEL_CLASS,
    POPOVER_TITLE_CLASS,
  } from "@/features/editor/nodes/table/tableStyles";
  import type { IndexOptions } from "./TableSettingsPopover.svelte";
  import AddIndexForm from "./AddIndexForm.svelte";
  import IndexRow from "./IndexRow.svelte";

  let {
    table,
    palette,
    onRename,
    onStyleChange,
    onAddIndex,
    onUpdateIndex,
    onDeleteIndex,
    triggerRect,
    trigger,
    onClose,
  }: {
    table: Table;
    palette: string[];
    onRename: (name: string) => void;
    onStyleChange: (color: string | undefined, borderColor: string | undefined) => void;
    onAddIndex?: (fieldIds: string[], options: IndexOptions) => void;
    onUpdateIndex?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
    onDeleteIndex?: (indexId: string) => void;
    triggerRect: DOMRect;
    trigger: HTMLElement | undefined;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let addingIndex = $state(false);
  let popover: HTMLDivElement | undefined = $state();

  const name = useDraftValue(
    () => table.name,
    (next) => onRename(next!),
  );

  useDismissablePopover(
    () => true,
    () => onClose(),
    () => [popover, trigger],
  );
  useCloseOnViewportChange(
    () => true,
    () => onClose(),
  );

  const currentColor = $derived(table.style?.color ?? DEFAULT_HEADER_COLOR);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  use:portal
  use:anchoredPlacement={{ rect: triggerRect, side: "right" }}
  bind:this={popover}
  class="fixed z-[var(--z-popover)] flex w-[300px] flex-col gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 shadow-lg nodrag"
  style={provisionalPopoverStyle(triggerRect)}
  onclick={(event) => event.stopPropagation()}
  onmousedown={(event) => event.stopPropagation()}
>
  <div class={POPOVER_HEADER_CLASS}>
    <span class={POPOVER_TITLE_CLASS}>{t("table.settingsTitle")}</span>
  </div>

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("table.nameLabel")}</label>
    <input
      class={POPOVER_INPUT_CLASS}
      bind:value={name.value}
      maxlength={MAX_NAME_LENGTH}
      onblur={() => name.commit()}
      onkeydown={name.handleKeyDown}
      placeholder={t("table.namePlaceholder")}
    />
  </div>

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("table.headerColor")}</label>
    <div class={`${SWATCH_GRID_CLASS} mt-1`}>
      {#each palette as color (color)}
        <button
          type="button"
          class={`${SWATCH_CELL_CLASS} ${color.toLowerCase() === currentColor.toLowerCase() ? SWATCH_CELL_ACTIVE_CLASS : ""}`}
          style:background={color}
          onclick={() => onStyleChange(color, table.style?.borderColor)}
          data-tooltip={color}
          aria-label={color}
        ></button>
      {/each}
    </div>
  </div>

  {#if onAddIndex || table.indexes.length > 0}
    <div class={POPOVER_GROUP_CLASS}>
      <div class="flex items-center justify-between">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class={POPOVER_LABEL_CLASS}>
          {t("table.index.sectionTitle")}
          {table.indexes.length > 0 ? `(${table.indexes.length})` : ""}
        </label>
        {#if onAddIndex && !addingIndex}
          <button
            type="button"
            class="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-hover"
            onclick={() => (addingIndex = true)}
          >
            <Icon icon={PlusIcon} size={11} />
            {t("common.add")}
          </button>
        {/if}
      </div>

      {#if table.indexes.length === 0 && !addingIndex}
        <p class="text-[11px] italic text-text-muted">{t("table.index.empty")}</p>
      {/if}

      <div class="flex flex-col gap-1.5">
        {#each table.indexes as index (index.id)}
          <IndexRow {index} {table} onUpdate={onUpdateIndex} onDelete={onDeleteIndex} />
        {/each}
      </div>

      {#if addingIndex && onAddIndex}
        <AddIndexForm {table} onAdd={onAddIndex} onCancel={() => (addingIndex = false)} />
      {/if}
    </div>
  {/if}
</div>
