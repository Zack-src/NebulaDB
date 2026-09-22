<script lang="ts">
  import type { Comment, Field, RefAction } from "@athanordb/shared";
  import type { FieldRefInfo } from "@/features/editor/nodes/table/fieldRefInfo";
  import Icon from "@/components/icons/Icon.svelte";
  import { PencilIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import FieldEditorPanel from "./FieldEditorPanel.svelte";

  /**
   * Column's pencil button — opens a popover to edit name/type/default/note,
   * toggle pk/unique/notNull/increment, and manage the column's comment thread.
   *
   * Only the trigger lives here: every column row on the canvas carries one of
   * these, so the panel itself (drafts, dismiss listeners, viewport watch) is
   * only created while it's open.
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
    triggerClassName,
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
    triggerClassName: string;
  } = $props();

  const { t } = useTranslation();
  let open = $state(false);
  let triggerRect = $state.raw<DOMRect | null>(null);
  let trigger: HTMLButtonElement | undefined = $state();

  function toggleOpen() {
    if (!open && trigger) {
      // Anchored to the right of the whole table (not just this row's
      // trigger) so the popover sits beside the table instead of dropping
      // down over it — matches TableSettingsPopover.
      const tableRect = trigger.closest(".table-node")?.getBoundingClientRect();
      triggerRect = tableRect ?? trigger.getBoundingClientRect();
    }
    open = !open;
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class={`nodrag ${triggerClassName}${open ? " has-open-popover" : ""}`}
  onclick={(event) => {
    event.stopPropagation();
    toggleOpen();
  }}
  ondblclick={(event) => event.stopPropagation()}
  data-tooltip={t("field.editTooltip")}
  aria-label={t("field.editTooltip")}
>
  <Icon icon={PencilIcon} size={11} />
</button>
{#if open && triggerRect}
  <FieldEditorPanel
    {field}
    {comments}
    {currentUser}
    {onUpdateField}
    {onDeleteField}
    {onAddComment}
    {onDeleteComment}
    {fieldRefs}
    {onUpdateRefAction}
    {triggerRect}
    {trigger}
    onClose={() => (open = false)}
  />
{/if}
