<script lang="ts" module>
  import type { FieldRefInfo } from "@/features/editor/nodes/table/fieldRefInfo";

  /** Shared empty array for a field that's on no ref's FK side — one allocation, not one per row per render. */
  const EMPTY_FIELD_REFS: FieldRefInfo[] = [];
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import { MAX_NAME_LENGTH, type Field } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon, CodeIcon, PlusIcon } from "@/components/icons/Icons";
  import CommentThread from "@/features/editor/comments/CommentThread.svelte";
  import TableSettingsPopover from "@/features/editor/nodes/table/TableSettingsPopover.svelte";
  import TableNodeRow from "@/features/editor/nodes/table/TableNodeRow.svelte";
  import { getCanvasContext } from "@/features/editor/canvas/canvasContext";
  import { scheduleNodeInternalsUpdate } from "@/features/editor/canvas/nodeInternalsBatch";
  import type { TableNodeType } from "@/features/editor/nodes/nodeTypes";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { prefersDarkText } from "@/utils/color";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    DEFAULT_HEADER_COLOR,
    HEADER_ACTIONS_CLASS,
    HEADER_BTN_CLASS,
    TABLE_ADD_BTN_CLASS,
    TABLE_FOOTER_CLASS,
    TABLE_HEADER_CLASS,
    TABLE_NAME_CLASS,
    TABLE_NAME_INPUT_CLASS,
    TABLE_NODE_CLASS,
    TABLE_NODE_SELECTED_CLASS,
  } from "@/features/editor/nodes/table/tableStyles";

  /**
   * One table on the canvas: coloured header (rename, comments, settings,
   * jump-to-DBML, validation badge), one row per visible column, and the
   * "add column" footer.
   *
   * No memo comparator any more: a Svelte component only re-evaluates the
   * expressions whose inputs actually changed, and the node cache in
   * `canvasNodes` already hands back the *same* `data` object for every table
   * a doc update didn't touch — so an edit to table B does no work at all in
   * table A.
   */
  let { id, data, selected = false }: NodeProps<TableNodeType> = $props();

  const { t } = useTranslation();
  const canvas = getCanvasContext();
  let root: HTMLDivElement | undefined = $state();
  let renaming = $state(false);
  const nameDraft = useDraftValue(
    () => data.table.name,
    (next) => data.onRename(next ?? ""),
  );

  let isTableHovered = false;
  // Nothing should keep this table "hovered" after it disappears mid-hover (a
  // delete, a view switch).
  $effect(() => () => {
    if (isTableHovered) data.onTableHoverChange?.(null);
  });

  function handleSelectField(fieldId: string) {
    data.onSelectField(fieldId);
    // Unselect the table node so the selection outline moves to the column itself.
    canvas.deselectAllNodes();
  }

  // If the table gets selected by its header, clear the column selection.
  let wasSelected = untrack(() => selected);
  $effect(() => {
    const now = selected;
    if (now === wasSelected) return;
    wasSelected = now;
    if (now && untrack(() => data.selectedFieldId)) data.onSelectField(null);
  });

  // A click anywhere but the selected row (or Escape) clears the column selection.
  useDismissablePopover(
    () => Boolean(data.selectedFieldId),
    () => data.onSelectField(null),
    () => [root?.querySelector<HTMLElement>(".table-node-row.is-selected")],
  );

  const table = $derived(data.table);
  const tableComments = $derived(table.comments?.filter((c) => !c.fieldId) ?? []);
  const headerColor = $derived(table.style?.color ?? DEFAULT_HEADER_COLOR);
  const issues = $derived(data.issues ?? []);
  const hasErrorIssue = $derived(issues.some((issue) => issue.severity === "error"));

  /**
   * Which of this table's columns sit on a highlighted relation — an O(1)
   * lookup into the map the canvas computes once for all tables (see
   * `canvas/highlightedFields.ts`). A string, so a rebuild of that map that
   * didn't change *this* table's entry doesn't reach anything below.
   */
  const linkedFieldKey = $derived(canvas.highlightedFields.get(table.id) ?? "");
  const selectedEdgeFieldIds = $derived(new Set(linkedFieldKey ? linkedFieldKey.split("|") : []));

  // A 2+ column primary key is a composite index, not a per-field `pk` flag
  // (DBML/SQL have no other way to express it) — merge both so composite-key
  // columns get the same PK badge/visibility as a plain single-column `pk`.
  const pkIndexFieldIds = $derived.by(() => {
    const set = new Set<string>();
    for (const idx of table.indexes) {
      if (idx.pk) idx.fieldIds.forEach((fieldId) => set.add(fieldId));
    }
    return set;
  });
  const isPkField = (field: Field) => field.pk || pkIndexFieldIds.has(field.id);

  const rows = $derived(
    table.detailLevel === "compact"
      ? []
      : table.detailLevel === "full"
        ? table.fields
        : table.fields.filter((f) => isPkField(f) || data.refFieldIds.has(f.id)),
  );

  // Each column row carries its own left/right handles, keyed by field id, so
  // reordering columns moves a handle's on-screen position without changing
  // the node's outer size — the flow only re-measures handle bounds on
  // resize, so a reorder alone leaves every edge anchored to the row's *old*
  // position until something tells it to look again. The field-id order
  // joined into one string is the trigger, so this only fires on an actual
  // reorder (or add/remove) — never on mount, where the flow's own first
  // measurement already covers it.
  const fieldOrderKey = $derived(rows.map((f) => f.id).join("|"));
  let lastFieldOrderKey = untrack(() => fieldOrderKey);
  $effect(() => {
    const key = fieldOrderKey;
    if (key === lastFieldOrderKey) return;
    lastFieldOrderKey = key;
    scheduleNodeInternalsUpdate(id);
  });

  // Figma shows one name per remote selector, not a pile of avatars — the
  // first is enough to say who, "+N" covers the rest without crowding the
  // canvas.
  const remoteSelectedBy = $derived(canvas.remoteSelections.get(table.id));
  const primaryRemoteSelector = $derived(remoteSelectedBy?.[0]);
</script>

{#if primaryRemoteSelector}
  <!-- A sibling of the table box, not a child of it: the box has
       `overflow-hidden` for its rows, which would clip a label above it. -->
  <div
    class="pointer-events-none absolute -top-[19px] left-0 z-10 whitespace-nowrap rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
    style:background={primaryRemoteSelector.color}
  >
    {primaryRemoteSelector.name}{remoteSelectedBy && remoteSelectedBy.length > 1
      ? ` +${remoteSelectedBy.length - 1}`
      : ""}
  </div>
{/if}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={root}
  class={`group table-node ${TABLE_NODE_CLASS} ${selected ? `is-selected ${TABLE_NODE_SELECTED_CLASS}` : ""}`}
  onmouseenter={() => {
    isTableHovered = true;
    data.onTableHoverChange?.(table.id);
  }}
  onmouseleave={() => {
    isTableHovered = false;
    data.onTableHoverChange?.(null);
  }}
  style:border-color={selected ? "var(--color-primary)" : table.style?.borderColor}
  style:outline={primaryRemoteSelector ? `2px solid ${primaryRemoteSelector.color}` : undefined}
  style:outline-offset={primaryRemoteSelector ? "2px" : undefined}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class={TABLE_HEADER_CLASS}
    style:background={headerColor}
    style:color={prefersDarkText(headerColor) ? "var(--color-text-on-light)" : "#ffffff"}
    ondblclick={() => {
      if (!data.readOnly) renaming = true;
    }}
  >
    <Handle type="target" position={Position.Left} id="header-left-target" style="opacity: 0" />
    <Handle type="source" position={Position.Left} id="header-left-source" style="opacity: 0" />
    <Handle type="target" position={Position.Right} id="header-right-target" style="opacity: 0" />
    <Handle type="source" position={Position.Right} id="header-right-source" style="opacity: 0" />
    {#if renaming}
      <input
        use:autofocus
        class={`nodrag ${TABLE_NAME_INPUT_CLASS}`}
        bind:value={nameDraft.value}
        onblur={() => {
          nameDraft.commit();
          renaming = false;
        }}
        maxlength={MAX_NAME_LENGTH}
        onkeydown={(event) => {
          nameDraft.handleKeyDown(event);
          if (event.key === "Enter") renaming = false;
          if (event.key === "Escape") {
            nameDraft.setValue(table.name);
            renaming = false;
          }
        }}
      />
    {:else}
      <span
        class={TABLE_NAME_CLASS}
        data-tooltip={table.note ? table.name : data.readOnly ? table.name : t("table.doubleClickToRename")}
        data-tooltip-note={table.note || undefined}
      >
        {table.name}
      </span>
    {/if}

    <div class={HEADER_ACTIONS_CLASS}>
      {#if issues.length > 0}
        <span
          class={`nodrag flex items-center ${hasErrorIssue ? "text-danger" : "text-warning"}`}
          data-tooltip={t("table.validationIssueCount", { count: issues.length })}
          data-tooltip-note={issues.map((issue) => issue.message).join("\n")}
        >
          <Icon icon={AlertTriangleIcon} size={13} />
        </span>
      {/if}
      {#if data.onGoToDbml}
        <button
          type="button"
          class={`${HEADER_BTN_CLASS} nodrag`}
          onclick={(event) => {
            event.stopPropagation();
            data.onGoToDbml?.();
          }}
          data-tooltip={t("table.goToDbml")}
          aria-label={t("table.goToDbml")}
        >
          <Icon icon={CodeIcon} size={13} />
        </button>
      {/if}
      {#if !data.readOnly}
        <CommentThread
          comments={tableComments}
          currentUser={data.currentUser}
          onAdd={(text) => data.onAddComment(text)}
          onDelete={data.onDeleteComment}
          triggerClassName={HEADER_BTN_CLASS}
          tooltip={t("table.comments")}
        />
        <TableSettingsPopover
          {table}
          palette={data.palette}
          onRename={data.onRename}
          onStyleChange={data.onStyleChange}
          onAddIndex={data.onAddIndex}
          onUpdateIndex={data.onUpdateIndex}
          onDeleteIndex={data.onDeleteIndex}
          triggerClassName={HEADER_BTN_CLASS}
        />
      {/if}
    </div>
  </div>
  {#each rows as field (field.id)}
    <TableNodeRow
      {field}
      comments={table.comments?.filter((c) => c.fieldId === field.id) ?? []}
      isPk={isPkField(field)}
      isForeignKey={data.refFieldIds.has(field.id)}
      isLinked={Boolean(
        selectedEdgeFieldIds.has(field.id) || (data.selectedFieldId === field.id && data.refFieldIds.has(field.id)),
      )}
      isSelected={data.selectedFieldId === field.id}
      currentUser={data.currentUser}
      onSelect={() => handleSelectField(field.id)}
      onHoverStart={() => data.onFieldHoverChange(field.id)}
      onHoverEnd={() => data.onFieldHoverChange(null)}
      onAddComment={(text) => data.onAddComment(text, field.id)}
      onDeleteComment={data.onDeleteComment}
      onUpdateField={data.onUpdateField}
      onDeleteField={data.onDeleteField}
      fieldRefs={data.fieldRefs?.get(field.id) ?? EMPTY_FIELD_REFS}
      onUpdateRefAction={data.onUpdateRefAction}
      onReorderField={data.onReorderField}
    />
  {/each}
  {#if data.onAddField && table.detailLevel !== "compact"}
    <div class={TABLE_FOOTER_CLASS}>
      <button
        type="button"
        class={`${TABLE_ADD_BTN_CLASS} nodrag`}
        onclick={(event) => {
          event.stopPropagation();
          const count = table.fields.length + 1;
          data.onAddField?.({ name: `field_${count}`, type: "int" });
        }}
        data-tooltip={t("table.addColumnTooltip")}
      >
        <Icon icon={PlusIcon} size={12} />
        {t("table.addColumn")}
      </button>
    </div>
  {/if}
</div>
