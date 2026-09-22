<script lang="ts" module>
  const COMMON_TYPES = ["int", "varchar", "text", "boolean", "timestamp", "uuid", "json", "decimal", "bigint"];
</script>

<script lang="ts">
  import {
    MAX_DEFAULT_LENGTH,
    MAX_NAME_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_TEXT_LENGTH,
    MAX_TYPE_LENGTH,
    type Comment,
    type Field,
    type RefAction,
  } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import { anchoredPlacement, provisionalPopoverStyle } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import type { FieldRefInfo } from "@/features/editor/nodes/table/fieldRefInfo";
  import { ACTION_SELECT_CLASS, REF_ACTIONS, REF_ACTION_LABEL_KEY } from "@/features/editor/edges/refActionOptions";
  import Icon from "@/components/icons/Icon.svelte";
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import {
    AsteriskIcon,
    CloseIcon,
    DiamondIcon,
    IncrementIcon,
    KeyIcon,
    TrashIcon,
  } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { TEXTAREA_SM_CLASS } from "@/components/ui/inputStyles";
  import { formatTimestamp } from "@/features/editor/comments/formatTimestamp";
  import { useCloseOnViewportChange } from "@/hooks/closeOnViewportChange.svelte";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import {
    FIELD_TYPE_CHIP_ACTIVE_CLASS,
    FIELD_TYPE_CHIP_CLASS,
    KW_TOGGLE_ACTIVE_CLASS,
    KW_TOGGLE_BASE_CLASS,
    POPOVER_GROUP_CLASS,
    POPOVER_HEADER_CLASS,
    POPOVER_INPUT_CLASS,
    POPOVER_INPUT_MONO_CLASS,
    POPOVER_LABEL_CLASS,
    POPOVER_TITLE_CLASS,
  } from "@/features/editor/nodes/table/tableStyles";

  /**
   * The column properties popover. Comments live here too (not just behind
   * their own indicator icon) because that icon only appears once a comment
   * already exists — this is the one place a column with no comments yet can
   * still get its first one.
   */
  let {
    field,
    comments,
    currentUser,
    onUpdateField,
    onDeleteField,
    onAddComment,
    onDeleteComment,
    fieldRefs,
    onUpdateRefAction,
    triggerRect,
    trigger,
    onClose,
  }: {
    field: Field;
    comments: Comment[];
    currentUser: string;
    onUpdateField?: (fieldId: string, updates: Partial<Field> | ((current: Field) => Partial<Field>)) => void;
    onDeleteField?: (fieldId: string) => void;
    onAddComment: (text: string) => void;
    onDeleteComment: (commentId: string) => void;
    fieldRefs?: FieldRefInfo[];
    onUpdateRefAction?: (refId: string, patch: { onDelete?: RefAction; onUpdate?: RefAction }) => void;
    triggerRect: DOMRect;
    trigger: HTMLElement | undefined;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let commentDraft = $state("");
  let popover: HTMLDivElement | undefined = $state();

  const update = (updates: Partial<Field> | ((current: Field) => Partial<Field>)) => onUpdateField?.(field.id, updates);

  const name = useDraftValue(
    () => field.name,
    (next) => update({ name: next }),
  );
  const type = useDraftValue(
    () => field.type,
    (next) => update({ type: next }),
  );
  const defaultValue = useDraftValue(
    () => field.default ?? "",
    (next) => update({ default: next }),
    { allowEmpty: true },
  );
  const note = useDraftValue(
    () => field.note ?? "",
    (next) => update({ note: next }),
    { allowEmpty: true },
  );

  function submitComment() {
    const text = commentDraft.trim();
    if (!text) return;
    onAddComment(text);
    commentDraft = "";
  }

  useDismissablePopover(
    () => true,
    () => onClose(),
    () => [popover, trigger],
  );
  useCloseOnViewportChange(
    () => true,
    () => onClose(),
  );

  interface AttributeToggle {
    active: boolean | undefined;
    activeClass: string;
    icon: IconDefinition;
    iconSize: number;
    labelKey: TranslationKeyOf;
    tooltipKey: TranslationKeyOf;
    apply: () => void;
  }

  // Each toggle is computed from the field as it is in the doc *at click
  // time* (an updater, not `!field.pk`), so spam-clicking one advances every
  // click instead of flipping back and forth off a stale value.
  const attributeToggles: AttributeToggle[] = $derived([
    {
      active: field.pk,
      activeClass: KW_TOGGLE_ACTIVE_CLASS.pk,
      icon: KeyIcon,
      iconSize: 12,
      labelKey: "field.primaryKey",
      tooltipKey: "field.primaryKeyTooltip",
      apply: () => update((f) => ({ pk: !f.pk })),
    },
    {
      active: field.unique,
      activeClass: KW_TOGGLE_ACTIVE_CLASS.unique,
      icon: DiamondIcon,
      iconSize: 10,
      labelKey: "field.unique",
      tooltipKey: "field.uniqueTooltip",
      apply: () => update((f) => ({ unique: !f.unique })),
    },
    {
      active: field.notNull,
      activeClass: KW_TOGGLE_ACTIVE_CLASS.notNull,
      icon: AsteriskIcon,
      iconSize: 11,
      labelKey: "field.notNull",
      tooltipKey: "field.notNullTooltip",
      apply: () => update((f) => ({ notNull: !f.notNull })),
    },
    {
      active: field.increment,
      activeClass: KW_TOGGLE_ACTIVE_CLASS.increment,
      icon: IncrementIcon,
      iconSize: 11,
      labelKey: "field.increment",
      tooltipKey: "field.incrementTooltip",
      apply: () => update((f) => ({ increment: !f.increment })),
    },
  ]);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  use:portal
  use:anchoredPlacement={{ rect: triggerRect, side: "right" }}
  bind:this={popover}
  class="fixed z-[var(--z-popover)] flex w-[296px] flex-col gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 shadow-lg nodrag"
  style={provisionalPopoverStyle(triggerRect)}
  onclick={(event) => event.stopPropagation()}
  onmousedown={(event) => event.stopPropagation()}
>
  <div class={POPOVER_HEADER_CLASS}>
    <span class={POPOVER_TITLE_CLASS}>{t("field.propertiesTitle")}</span>
    <Button
      variant="danger-ghost"
      size="icon"
      onclick={() => {
        onDeleteField?.(field.id);
        onClose();
      }}
      data-tooltip={t("field.delete")}
    >
      <Icon icon={TrashIcon} size={13} />
    </Button>
  </div>

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("field.nameLabel")}</label>
    <input
      use:autofocus
      class={POPOVER_INPUT_CLASS}
      bind:value={name.value}
      maxlength={MAX_NAME_LENGTH}
      onblur={() => name.commit()}
      onkeydown={name.handleKeyDown}
      placeholder={t("field.namePlaceholder")}
    />
  </div>

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("field.typeLabel")}</label>
    <input
      class={POPOVER_INPUT_MONO_CLASS}
      bind:value={type.value}
      maxlength={MAX_TYPE_LENGTH}
      onblur={() => type.commit()}
      onkeydown={type.handleKeyDown}
      placeholder={t("field.typePlaceholder")}
    />
    <div class="mt-0.5 flex flex-wrap gap-1">
      {#each COMMON_TYPES as commonType (commonType)}
        <button
          type="button"
          class={`${FIELD_TYPE_CHIP_CLASS} ${field.type === commonType ? FIELD_TYPE_CHIP_ACTIVE_CLASS : ""}`}
          onclick={() => {
            type.setValue(commonType);
            type.commit(commonType);
          }}
        >
          {commonType}
        </button>
      {/each}
    </div>
  </div>

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("field.attributesLabel")}</label>
    <div class="grid grid-cols-2 gap-[5px]">
      {#each attributeToggles as toggle (toggle.labelKey)}
        <button
          type="button"
          class={`${KW_TOGGLE_BASE_CLASS} ${toggle.active ? toggle.activeClass : ""}`}
          onclick={toggle.apply}
          data-tooltip={t(toggle.tooltipKey)}
        >
          <Icon icon={toggle.icon} size={toggle.iconSize} />
          {t(toggle.labelKey)}
        </button>
      {/each}
    </div>
  </div>

  <!-- Only for a column that's actually the FK side of some ref — a plain
       column has no ON DELETE/ON UPDATE to configure. When it's on more than
       one ref (rare — a composite/shared FK column), each gets its own pair of
       selects, labeled by what it points at. -->
  {#if fieldRefs && fieldRefs.length > 0}
    <div class={`${POPOVER_GROUP_CLASS} border-t border-border pt-3`}>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={POPOVER_LABEL_CLASS}>{t("field.referentialActionsLabel")}</label>
      {#each fieldRefs as fr (fr.refId)}
        <div class="flex flex-col gap-2">
          {#if fieldRefs.length > 1}
            <span class="font-mono text-[10.5px] text-text-muted">→ {fr.toLabel}</span>
          {/if}
          <div class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="text-[10.5px] text-text-muted">{t("edge.onDelete")}</label>
              <select
                class={ACTION_SELECT_CLASS}
                value={fr.onDelete ?? ""}
                disabled={!onUpdateRefAction}
                onchange={(e) =>
                  onUpdateRefAction?.(fr.refId, {
                    onDelete: (e.currentTarget.value || undefined) as RefAction | undefined,
                  })}
              >
                <option value="">{t("edge.action.default")}</option>
                {#each REF_ACTIONS as action (action)}
                  <option value={action}>{t(REF_ACTION_LABEL_KEY[action])}</option>
                {/each}
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="text-[10.5px] text-text-muted">{t("edge.onUpdate")}</label>
              <select
                class={ACTION_SELECT_CLASS}
                value={fr.onUpdate ?? ""}
                disabled={!onUpdateRefAction}
                onchange={(e) =>
                  onUpdateRefAction?.(fr.refId, {
                    onUpdate: (e.currentTarget.value || undefined) as RefAction | undefined,
                  })}
              >
                <option value="">{t("edge.action.default")}</option>
                {#each REF_ACTIONS as action (action)}
                  <option value={action}>{t(REF_ACTION_LABEL_KEY[action])}</option>
                {/each}
              </select>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("field.defaultLabel")}</label>
    <input
      class={POPOVER_INPUT_MONO_CLASS}
      bind:value={defaultValue.value}
      maxlength={MAX_DEFAULT_LENGTH}
      onblur={() => defaultValue.commit()}
      onkeydown={defaultValue.handleKeyDown}
      placeholder={t("field.defaultPlaceholder")}
    />
  </div>

  <div class={POPOVER_GROUP_CLASS}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("field.noteLabel")}</label>
    <input
      class={POPOVER_INPUT_CLASS}
      bind:value={note.value}
      maxlength={MAX_NOTE_LENGTH}
      onblur={() => note.commit()}
      onkeydown={note.handleKeyDown}
      placeholder={t("field.notePlaceholder")}
    />
  </div>

  <div class={`${POPOVER_GROUP_CLASS} border-t border-border pt-3`}>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={POPOVER_LABEL_CLASS}>{t("comments.title")}</label>
    {#if comments.length > 0}
      <div class="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">
        {#each comments as comment (comment.id)}
          <div class="rounded-sm bg-surface p-1.5">
            <div class="mb-0.5 flex items-baseline gap-1.5">
              <span class="text-[11.5px] font-bold text-text">{comment.author}</span>
              <span class="flex-1 text-[10.5px] text-text-muted">{formatTimestamp(comment.createdAt)}</span>
              {#if comment.author === currentUser}
                <button
                  type="button"
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-danger-light hover:text-danger"
                  onclick={() => onDeleteComment(comment.id)}
                  data-tooltip={t("comments.delete")}
                  aria-label={t("comments.delete")}
                >
                  <Icon icon={CloseIcon} size={11} />
                </button>
              {/if}
            </div>
            <div class="whitespace-pre-wrap break-words text-[12.5px] leading-[1.4] text-text-secondary">{comment.text}</div>
          </div>
        {/each}
      </div>
    {/if}
    <div class="flex gap-1.5">
      <textarea
        class={`${TEXTAREA_SM_CLASS} flex-1`}
        bind:value={commentDraft}
        placeholder={t("comments.placeholder")}
        maxlength={MAX_TEXT_LENGTH}
        onkeydown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submitComment();
        }}
      ></textarea>
      <Button variant="primary" size="sm" onclick={submitComment} disabled={!commentDraft.trim()}>
        {t("comments.post")}
      </Button>
    </div>
  </div>
</div>
