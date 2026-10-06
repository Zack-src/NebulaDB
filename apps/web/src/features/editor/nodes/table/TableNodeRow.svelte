<script lang="ts" module>
  /** Custom drag MIME so a column drag is never mistaken for some other drag-and-drop the browser/OS might offer over the canvas (e.g. dropping a file). */
  const FIELD_DRAG_MIME = "application/x-nebuladb-field";
</script>

<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import { readableNote } from "@nebuladb/dbml-engine";
  import { MAX_NAME_LENGTH, type Comment, type Field, type RefAction } from "@nebuladb/shared";
  import { autofocus } from "@/actions/autofocus";
  import type { FieldRefInfo } from "@/features/editor/nodes/table/fieldRefInfo";
  import CommentThread from "@/features/editor/comments/CommentThread.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { AsteriskIcon, DiamondIcon, GripVerticalIcon, IncrementIcon, NoteIcon } from "@/components/icons/Icons";
  import FieldBadge from "@/features/editor/nodes/table/FieldBadge.svelte";
  import FieldEditorPopover from "@/features/editor/nodes/table/FieldEditorPopover.svelte";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    KW_BADGE_CLASS,
    KW_BADGE_COLOR,
    ROW_ACTIONS_CLASS,
    ROW_ACTION_BTN_CLASS,
    ROW_ACTION_PLACEHOLDER_CLASS,
    ROW_BADGES_CLASS,
    ROW_CLASS,
    ROW_DRAG_HANDLE_CLASS,
    ROW_DRAG_HANDLE_PLACEHOLDER_CLASS,
    ROW_NAME_CLASS,
    ROW_NAME_INPUT_CLASS,
    ROW_TYPE_CLASS,
    rowDropIndicatorClass,
    rowStateClass,
  } from "@/features/editor/nodes/table/tableStyles";

  /**
   * One field row: side handles, badge/name/type, PK/UQ/NN/AI/note badges, and
   * the edit + comment popovers.
   */
  let {
    field,
    comments,
    isPk,
    isForeignKey,
    isLinked,
    isSelected,
    actionsVisible,
    currentUser,
    onSelect,
    onHoverStart,
    onHoverEnd,
    onAddComment,
    onDeleteComment,
    onUpdateField,
    onDeleteField,
    onReorderField,
    fieldRefs,
    onUpdateRefAction,
  }: {
    field: Field;
    comments: Comment[];
    isPk: boolean;
    isForeignKey: boolean;
    isLinked: boolean;
    isSelected: boolean;
    /**
     * Whether the pointer is over this row's table. The reorder grip and the
     * edit button only show then, so they only *exist* then: a 100-table
     * schema at full detail otherwise keeps 1 600 hidden buttons — elements,
     * icons, listeners and the reactive bookkeeping behind each — for the
     * eight the pointer can reach.
     */
    actionsVisible: boolean;
    currentUser: string;
    onSelect: () => void;
    onHoverStart: () => void;
    onHoverEnd: () => void;
    onAddComment: (text: string) => void;
    onDeleteComment: (commentId: string) => void;
    onUpdateField?: (fieldId: string, updates: Partial<Field> | ((current: Field) => Partial<Field>)) => void;
    onDeleteField?: (fieldId: string) => void;
    onReorderField?: (draggedFieldId: string, targetFieldId: string, before: boolean) => void;
    /** Refs where this field is the FK ("from") side — usually 0 or 1, more if the column somehow FKs into several tables. */
    fieldRefs?: FieldRefInfo[];
    onUpdateRefAction?: (refId: string, patch: { onDelete?: RefAction; onUpdate?: RefAction }) => void;
  } = $props();

  const { t } = useTranslation();
  let renaming = $state(false);
  const nameDraft = useDraftValue(
    () => field.name,
    (next) => onUpdateField?.(field.id, { name: next ?? "" }),
  );
  // Which side of this row a dragged-over column would land on — null when
  // nothing's being dragged over it right now. Local, not lifted: only the
  // row currently under the pointer needs to know.
  let dropSide = $state<"before" | "after" | null>(null);
  let editorOpen = $state(false);

  // Guards the teardown below: only a row that is itself the currently
  // hovered one should clear the shared hover state when it disappears (a
  // field deleted mid-hover) — an unrelated row going away must not clear
  // someone else's.
  let isHovered = false;
  $effect(() => () => {
    if (isHovered) onHoverEnd();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class={`table-node-row ${ROW_CLASS} ${rowStateClass(isLinked, isForeignKey, isSelected)} ${rowDropIndicatorClass(dropSide)}`}
  data-tooltip={`${field.name} (${field.type})`}
  data-tooltip-note={readableNote(field.note)}
  onclick={(event) => {
    event.stopPropagation();
    onSelect();
  }}
  onmouseenter={() => {
    isHovered = true;
    onHoverStart();
  }}
  onmouseleave={() => {
    isHovered = false;
    onHoverEnd();
  }}
  ondragover={(event) => {
    if (!onReorderField || !event.dataTransfer?.types.includes(FIELD_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    dropSide = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }}
  ondragleave={() => (dropSide = null)}
  ondrop={(event) => {
    if (!onReorderField || !event.dataTransfer?.types.includes(FIELD_DRAG_MIME)) return;
    event.preventDefault();
    const draggedFieldId = event.dataTransfer.getData(FIELD_DRAG_MIME);
    if (draggedFieldId && draggedFieldId !== field.id) {
      onReorderField(draggedFieldId, field.id, dropSide !== "after");
    }
    dropSide = null;
  }}
>
  <Handle type="target" position={Position.Left} id={`${field.id}-left-target`} class="table-row-handle" />
  <Handle type="source" position={Position.Left} id={`${field.id}-left-source`} class="table-row-handle" />
  {#if !onReorderField}
    <!-- Read-only: no grip, and no room kept for one. -->
  {:else if !actionsVisible}
    <!-- Holds the grip's place, so the table isn't a few pixels narrower
         whenever the pointer is elsewhere. -->
    <span class={ROW_DRAG_HANDLE_PLACEHOLDER_CLASS}></span>
  {:else}
    <span
      class={`nodrag ${ROW_DRAG_HANDLE_CLASS}`}
      draggable="true"
      role="button"
      tabindex="-1"
      ondragstart={(event) => {
        event.dataTransfer?.setData(FIELD_DRAG_MIME, field.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      }}
      onclick={(event) => event.stopPropagation()}
      data-tooltip={t("field.dragToReorder")}
    >
      <Icon icon={GripVerticalIcon} size={12} />
    </span>
  {/if}
  {#if renaming}
    <input
      use:autofocus
      class={`nodrag ${ROW_NAME_INPUT_CLASS}`}
      bind:value={nameDraft.value}
      onclick={(event) => event.stopPropagation()}
      onblur={() => {
        nameDraft.commit();
        renaming = false;
      }}
      maxlength={MAX_NAME_LENGTH}
      onkeydown={(event) => {
        event.stopPropagation();
        nameDraft.handleKeyDown(event);
        if (event.key === "Enter") renaming = false;
        if (event.key === "Escape") {
          nameDraft.setValue(field.name);
          renaming = false;
        }
      }}
    />
  {:else}
    <span
      class={ROW_NAME_CLASS}
      ondblclick={(event) => {
        if (!onUpdateField) return;
        event.stopPropagation();
        renaming = true;
      }}
    >
      {field.name}
    </span>
  {/if}

  <div class={ROW_BADGES_CLASS}>
    <FieldBadge {isForeignKey} {isPk} />
    {#if field.unique}
      <span class={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.unique}`} data-tooltip={t("field.unique")}>
        <Icon icon={DiamondIcon} size={16} />
      </span>
    {/if}
    {#if field.notNull}
      <span class={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.notNull}`} data-tooltip={t("field.notNull")}>
        <Icon icon={AsteriskIcon} size={16} />
      </span>
    {/if}
    {#if field.increment}
      <span class={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.increment}`} data-tooltip={t("field.increment")}>
        <Icon icon={IncrementIcon} size={16} />
      </span>
    {/if}
    {#if field.note}
      <span
        class={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.note}`}
        data-tooltip={`${field.name} — note`}
        data-tooltip-note={readableNote(field.note)}
      >
        <Icon icon={NoteIcon} size={16} />
      </span>
    {/if}
  </div>

  <div class={ROW_ACTIONS_CLASS}>
    {#if actionsVisible || editorOpen}
      <FieldEditorPopover
        bind:open={editorOpen}
        {field}
        {comments}
        {currentUser}
        {onUpdateField}
        {onDeleteField}
        {onAddComment}
        {onDeleteComment}
        {fieldRefs}
        {onUpdateRefAction}
        triggerClassName={ROW_ACTION_BTN_CLASS}
      />
    {:else}
      <span class={ROW_ACTION_PLACEHOLDER_CLASS}></span>
    {/if}
    <!-- Only an indicator once a comment actually exists — not a standing
         invitation to add one on every column. Adding the first comment
         happens from the field's own properties (above) instead. -->
    {#if comments.length > 0}
      <CommentThread
        {comments}
        {currentUser}
        onAdd={onAddComment}
        onDelete={onDeleteComment}
        triggerClassName={ROW_ACTION_BTN_CLASS}
        tooltip={t("comments.onField", { field: field.name })}
      />
    {/if}
  </div>

  <span class={ROW_TYPE_CLASS}>{field.type}</span>

  <Handle type="target" position={Position.Right} id={`${field.id}-right-target`} class="table-row-handle" />
  <Handle type="source" position={Position.Right} id={`${field.id}-right-source`} class="table-row-handle" />
</div>
