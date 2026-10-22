<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import { MAX_NAME_LENGTH, type Comment, type Table, type TableIndex } from "@nebuladb/shared";
  import CommentThreadBody from "@/features/editor/comments/CommentThreadBody.svelte";
  import { anchoredPlacement, provisionalPopoverStyle } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import Icon from "@/components/icons/Icon.svelte";
  import { CopyIcon, FileSpreadsheetIcon, LockIcon, LockOpenIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { SWATCH_CELL_ACTIVE_CLASS, SWATCH_CELL_CLASS, SWATCH_GRID_CLASS } from "@/components/inputs/colorSwatches";
  import { useCloseOnViewportChange } from "@/hooks/closeOnViewportChange.svelte";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    DEFAULT_HEADER_COLOR,
    POPOVER_GROUP_CLASS,
    POPOVER_HEADER_CLASS,
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
    onDuplicate,
    nameLocked = false,
    comments = [],
    currentUser = "",
    onAddComment,
    onDeleteComment,
    onManageLock,
    locked = false,
    onManageSeed,
    onDelete,
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
    onDuplicate?: () => void;
    nameLocked?: boolean;
    /** The table's own comments (not its columns'). */
    comments?: Comment[];
    currentUser?: string;
    onAddComment?: (text: string) => void;
    onDeleteComment?: (commentId: string) => void;
    /** Offered while the table is not locked: opens the lock dialog. */
    onManageLock?: () => void;
    /** The table is locked: the button changes or lifts the lock instead of placing one. */
    locked?: boolean;
    /** Offered while the table has no initial data: opens them to define some. */
    onManageSeed?: () => void;
    /** Removes the table (and the relations touching it). */
    onDelete?: () => void;
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
    {#if onDelete}
      <Button
        variant="danger-ghost"
        size="icon-xs"
        data-tooltip={t("common.delete")}
        aria-label={t("common.delete")}
        onclick={() => {
          onDelete();
          onClose();
        }}
      >
        <Icon icon={TrashIcon} size={13} />
      </Button>
    {/if}
  </div>

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("table.nameLabel")}</label>
    <Input
      inputSize="xs" class="w-full"
      disabled={nameLocked}
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

  {#if onDuplicate || onManageLock || onManageSeed}
    <div class="grid grid-cols-2 gap-2">
      {#if onDuplicate}
        <Button
          variant="default"
          size="md"
          class="!h-auto min-h-10 flex-col gap-0.5 whitespace-normal py-1.5 text-center leading-tight"
          onclick={() => {
            onDuplicate();
            onClose();
          }}
        >
          <Icon icon={CopyIcon} size={14} />
          {t("table.duplicate")}
        </Button>
      {/if}
      {#if onManageLock}
        <Button
          variant="default"
          size="md"
          class="!h-auto min-h-10 flex-col gap-0.5 whitespace-normal py-1.5 text-center leading-tight"
          onclick={() => {
            onManageLock();
            onClose();
          }}
        >
          <Icon icon={locked ? LockIcon : LockOpenIcon} size={14} />
          {locked ? t("locks.editLock") : t("locks.lockTooltip")}
        </Button>
      {/if}

      {#if onManageSeed}
        <Button
          variant="default"
          size="md"
          class="col-span-2 !h-auto min-h-10 flex-col gap-0.5 whitespace-normal py-1.5 text-center leading-tight"
          onclick={() => {
            onManageSeed();
            onClose();
          }}
        >
          <Icon icon={FileSpreadsheetIcon} size={14} />
          {t("seeds.addTooltip")}
        </Button>
      {/if}
    </div>
  {/if}

  {#if onAddComment && onDeleteComment}
    <div class={POPOVER_GROUP_CLASS}>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={POPOVER_LABEL_CLASS}>
        {t("table.comments")}
        {comments.length > 0 ? `(${comments.length})` : ""}
      </label>
      <div class="rounded-md border border-border bg-surface-raised">
        <CommentThreadBody {comments} {currentUser} onAdd={onAddComment} onDelete={onDeleteComment} />
      </div>
    </div>
  {/if}

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
            class="flex items-center gap-1 text-caption font-semibold text-primary hover:text-primary-hover"
            onclick={() => (addingIndex = true)}
          >
            <Icon icon={PlusIcon} size={11} />
            {t("common.add")}
          </button>
        {/if}
      </div>

      {#if table.indexes.length === 0 && !addingIndex}
        <p class="text-caption italic text-text-muted">{t("table.index.empty")}</p>
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
