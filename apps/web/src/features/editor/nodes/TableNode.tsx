import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { MAX_NAME_LENGTH, type Field, type Table, type TableIndex } from "@athanordb/shared";
import { CommentThread } from "@/features/editor/comments/CommentThread";
import type { RemoteSelector } from "@/features/collaboration/useRemoteSelections";
import { CodeIcon, PlusIcon } from "@/components/icons/Icons";
import { DEFAULT_HEADER_COLOR, TableSettingsPopover } from "@/features/editor/nodes/table/TableSettingsPopover";
import { TableNodeRow } from "@/features/editor/nodes/table/TableNodeRow";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";
import { useDraftValue } from "@/hooks/useDraftValue";
import { setsEqual } from "@/utils/setsEqual";
import { useHighlightedFieldKey } from "@/features/editor/canvas/highlightedFields";
import { prefersDarkText } from "@/utils/color";
import { useTranslation } from "@/i18n/useTranslation";
import {
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

export interface TableNodeData {
  table: Table;
  /** Field ids that are either endpoint of some ref touching this table — always shown outside compact, even if not PK. */
  refFieldIds: Set<string>;
  currentUser: string;
  palette: string[];
  /** True for a `view` grant — hides every editing affordance on the node. */
  readOnly?: boolean;
  selectedFieldId?: string | null;
  /** Remote collaborators who currently have this table selected — Figma-style outline, set by `CanvasArea`. */
  remoteSelectedBy?: RemoteSelector[];
  onSelectField: (fieldId: string | null) => void;
  onPaletteChange: (palette: string[]) => void;
  onRename: (name: string) => void;
  onGoToDbml?: () => void;
  /** Fires when the pointer enters/leaves a specific column row (`null` on leave) — narrows link highlighting to that column. */
  onFieldHoverChange: (fieldId: string | null) => void;
  /** Fires when the pointer enters/leaves a table (`null` on leave) — highlights all relations of the table. */
  onTableHoverChange?: (tableId: string | null) => void;
  onStyleChange: (color: string | undefined, borderColor: string | undefined) => void;
  onAddComment: (text: string, fieldId?: string) => void;
  onDeleteComment: (commentId: string) => void;
  onUpdateField?: (fieldId: string, updates: Partial<Field> | ((current: Field) => Partial<Field>)) => void;
  /** Drag-reorder a column: move `draggedFieldId` right before/after `targetFieldId`. */
  onReorderField?: (draggedFieldId: string, targetFieldId: string, before: boolean) => void;
  onAddField?: (field: Omit<Field, "id">) => void;
  onDeleteField?: (fieldId: string) => void;
  onAddIndex?: (fieldIds: string[], opts: { unique?: boolean; pk?: boolean; name?: string }) => void;
  onUpdateIndex?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
  onDeleteIndex?: (indexId: string) => void;
  [key: string]: unknown;
}

export type TableNodeType = Node<TableNodeData, "table">;

function TableNodeImpl({ data, selected, id }: NodeProps<TableNodeType>) {
  const { t } = useTranslation();
  const { table, refFieldIds, selectedFieldId, remoteSelectedBy, onSelectField, onTableHoverChange } = data;
  const { setNodes } = useReactFlow();
  const [renaming, setRenaming] = useState(false);
  const nameDraft = useDraftValue(table.name, (next) => data.onRename(next ?? ""));

  const isTableHoveredRef = useRef(false);
  useEffect(
    () => () => {
      if (isTableHoveredRef.current) onTableHoverChange?.(null);
    },
    [onTableHoverChange],
  );

  const handleSelectField = useCallback(
    (fieldId: string) => {
      onSelectField(fieldId);
      // Unselect the table node so the selection outline moves to the column itself
      setNodes((nds) => nds.map((n) => (n.id === id || n.selected ? { ...n, selected: false } : n)));
    },
    [id, onSelectField, setNodes],
  );

  // If table is selected by header, clear field selection
  const [wasSelected, setWasSelected] = useState(selected);
  if (wasSelected !== selected) {
    setWasSelected(selected);
    if (selected && selectedFieldId) {
      onSelectField(null);
    }
  }

  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  useDismissablePopover(Boolean(selectedFieldId), () => onSelectField(null), [selectedRowRef]);
  const tableComments = table.comments?.filter((c) => !c.fieldId) ?? [];
  const headerColor = table.style?.color ?? DEFAULT_HEADER_COLOR;

  /**
   * Which of this table's columns sit on a highlighted relation.
   *
   * An O(1) map lookup, not a store selector: this used to be a `useStore`
   * subscription walking the whole edge array per table, which zustand re-ran
   * for *every* table on *every* store mutation — pan/zoom transform ticks
   * included — for O(tables × edges) per store update. See
   * `canvas/highlightedFields.ts`, which now does that walk once for the
   * whole canvas and publishes a per-table key.
   */
  const linkedFieldKey = useHighlightedFieldKey(table.id);
  const selectedEdgeFieldIds = useMemo(
    () => new Set(linkedFieldKey ? linkedFieldKey.split("|") : []),
    [linkedFieldKey],
  );

  // A 2+ column primary key is a composite index, not a per-field `pk` flag
  // (DBML/SQL have no other way to express it) — merge both so composite-key
  // columns get the same PK badge/visibility as a plain single-column `pk`.
  const pkIndexFieldIds = useMemo(() => {
    const set = new Set<string>();
    for (const idx of table.indexes) {
      if (idx.pk) idx.fieldIds.forEach((id) => set.add(id));
    }
    return set;
  }, [table.indexes]);
  const isPkField = useCallback((field: Field) => field.pk || pkIndexFieldIds.has(field.id), [pkIndexFieldIds]);

  // Now that the table-node cache in `useCanvasNodes` lets `memo()` actually
  // skip unrelated tables, a re-render that *does* reach this table should
  // stay cheap too — memoized so a re-render caused by something this table
  // doesn't otherwise depend on (e.g. `selectedFieldId` moving to a different
  // table, which still changes this component's props) doesn't refilter
  // every field.
  const rows = useMemo(
    () =>
      table.detailLevel === "compact"
        ? []
        : table.detailLevel === "full"
          ? table.fields
          : table.fields.filter((f) => isPkField(f) || refFieldIds.has(f.id)),
    [table.detailLevel, table.fields, isPkField, refFieldIds],
  );

  // Figma shows one name per remote selector, not a pile of avatars — the
  // first is enough to say who, "+N" covers the rest without crowding the
  // canvas.
  const primaryRemoteSelector = remoteSelectedBy?.[0];

  return (
    <>
      {primaryRemoteSelector && (
        // Rendered as a sibling of the table box, not a child of it: the box
        // has `overflow-hidden` for its rows, which would clip a label
        // positioned above it.
        <div
          className="pointer-events-none absolute -top-[19px] left-0 z-10 whitespace-nowrap rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
          style={{ background: primaryRemoteSelector.color }}
        >
          {primaryRemoteSelector.name}
          {remoteSelectedBy && remoteSelectedBy.length > 1 ? ` +${remoteSelectedBy.length - 1}` : ""}
        </div>
      )}
      <div
        className={`group table-node ${TABLE_NODE_CLASS} ${selected ? `is-selected ${TABLE_NODE_SELECTED_CLASS}` : ""}`}
        onMouseEnter={() => {
          isTableHoveredRef.current = true;
          onTableHoverChange?.(table.id);
        }}
        onMouseLeave={() => {
          isTableHoveredRef.current = false;
          onTableHoverChange?.(null);
        }}
        style={{
          // Selected wins over a custom border colour rather than being
          // fought by it — an inline style always beats a class for the same
          // property, so without this a table with its own border colour
          // would never visibly show as selected.
          borderColor: selected ? "var(--color-primary)" : table.style?.borderColor,
          // `outline` rather than a second border: it's drawn outside the box
          // without affecting layout or fighting the border colour above, so
          // a table can show as both locally *and* remotely selected at once.
          outline: primaryRemoteSelector ? `2px solid ${primaryRemoteSelector.color}` : undefined,
          outlineOffset: primaryRemoteSelector ? 2 : undefined,
        }}
      >
        <div
          className={TABLE_HEADER_CLASS}
          style={{
            background: headerColor,
            color: prefersDarkText(headerColor) ? "var(--color-text-on-light)" : "#ffffff",
          }}
          onDoubleClick={() => {
            if (!data.readOnly) setRenaming(true);
          }}
        >
          <Handle type="target" position={Position.Left} id="header-left-target" style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Left} id="header-left-source" style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Right} id="header-right-target" style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Right} id="header-right-source" style={{ opacity: 0 }} />
          {renaming ? (
            <input
              autoFocus
              className={`nodrag ${TABLE_NAME_INPUT_CLASS}`}
              value={nameDraft.value}
              onChange={(event) => nameDraft.setValue(event.target.value)}
              onBlur={() => {
                nameDraft.commit();
                setRenaming(false);
              }}
              maxLength={MAX_NAME_LENGTH}
              onKeyDown={(event) => {
                nameDraft.handleKeyDown(event);
                if (event.key === "Enter") setRenaming(false);
                if (event.key === "Escape") {
                  nameDraft.setValue(table.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <span
              className={TABLE_NAME_CLASS}
              data-tooltip={table.note ? table.name : data.readOnly ? table.name : t("table.doubleClickToRename")}
              {...(table.note ? { "data-tooltip-note": table.note } : {})}
            >
              {table.name}
            </span>
          )}

          <div className={HEADER_ACTIONS_CLASS}>
            {data.onGoToDbml && (
              <button
                type="button"
                className={`${HEADER_BTN_CLASS} nodrag`}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onGoToDbml?.();
                }}
                data-tooltip={t("table.goToDbml")}
              >
                <CodeIcon size={13} />
              </button>
            )}
            {!data.readOnly && (
              <>
                <CommentThread
                  comments={tableComments}
                  currentUser={data.currentUser}
                  onAdd={(text) => data.onAddComment(text)}
                  onDelete={data.onDeleteComment}
                  triggerClassName={HEADER_BTN_CLASS}
                  tooltip={t("table.comments")}
                />
                <TableSettingsPopover
                  table={table}
                  palette={data.palette}
                  onRename={data.onRename}
                  onStyleChange={data.onStyleChange}
                  onAddIndex={data.onAddIndex}
                  onUpdateIndex={data.onUpdateIndex}
                  onDeleteIndex={data.onDeleteIndex}
                  triggerClassName={HEADER_BTN_CLASS}
                />
              </>
            )}
          </div>
        </div>
        {rows.map((field) => (
          <TableNodeRow
            key={field.id}
            ref={selectedFieldId === field.id ? selectedRowRef : undefined}
            field={field}
            comments={table.comments?.filter((c) => c.fieldId === field.id) ?? []}
            isPk={isPkField(field)}
            isForeignKey={refFieldIds.has(field.id)}
            // The canvas-wide "highlight every link" toggle is deliberately
            // not part of this: it is a CSS class on the canvas root combined
            // with the row's own `is-fk` marker (see `rowStateClass`), so
            // flipping it repaints without re-rendering a single node.
            isLinked={Boolean(
              selectedEdgeFieldIds.has(field.id) || (selectedFieldId === field.id && refFieldIds.has(field.id)),
            )}
            isSelected={selectedFieldId === field.id}
            currentUser={data.currentUser}
            onSelect={() => handleSelectField(field.id)}
            onHoverStart={() => data.onFieldHoverChange(field.id)}
            onHoverEnd={() => data.onFieldHoverChange(null)}
            onAddComment={(text) => data.onAddComment(text, field.id)}
            onDeleteComment={data.onDeleteComment}
            onUpdateField={data.onUpdateField}
            onDeleteField={data.onDeleteField}
            onReorderField={data.onReorderField}
          />
        ))}
        {data.onAddField && table.detailLevel !== "compact" && (
          <div className={TABLE_FOOTER_CLASS}>
            <button
              type="button"
              className={`${TABLE_ADD_BTN_CLASS} nodrag`}
              onClick={(event) => {
                event.stopPropagation();
                const count = table.fields.length + 1;
                data.onAddField?.({
                  name: `field_${count}`,
                  type: "int",
                });
              }}
              data-tooltip={t("table.addColumnTooltip")}
            >
              <PlusIcon size={12} /> {t("table.addColumn")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * `data` (and every callback closure inside it) is rebuilt from scratch by
 * `useCanvasNodes` on *any* project change — including one editing a
 * different table entirely, since the Yjs project is reconstructed wholesale
 * on every doc update — so `data` is never referentially stable across
 * renders even when nothing about *this* table changed. A plain `memo()`
 * (shallow prop comparison) is therefore defeated on every single edit
 * anywhere in the schema: with `onlyRenderVisibleElements` on the canvas
 * (`CanvasArea.tsx`), that meant every table crossing the viewport during a
 * pan/zoom/drag re-rendered and remounted, the dominant cost behind the
 * freezes measured at 100-200 tables.
 *
 * This comparator looks past the wrapping `data` object to the fields that
 * actually drive this component's output:
 *  - `table` — reference equality. Already stable per id at the Yjs layer
 *    (`readProjectFromDoc` only constructs a new object for a table Yjs
 *    actually re-`set()`), so this alone is what lets an edit to table B
 *    skip re-rendering table A.
 *  - `refFieldIds` — content equality (`setsEqual`), not reference: the Map
 *    it comes from (`ProjectEditor`'s `refFieldIdsByTable`) is a plain,
 *    unstabilized `useMemo` recomputed on every project change, so a fresh
 *    `Set` per table is expected; comparing membership rather than identity
 *    is what makes that harmless instead of another memo-defeater. Cheap:
 *    bounded by this one table's own field count, not the whole schema.
 *  - Every callback (`onRename`, `onStyleChange`, `onSelectField`, ...) is
 *    deliberately *not* compared: they're fresh closures every rebuild by
 *    construction, but each is a pure function of `table.id`/`doc`, which
 *    the checks above already establish are unchanged — a different
 *    function reference doing the exact same thing isn't a reason to
 *    re-render.
 */
function tableNodePropsAreEqual(prev: NodeProps<TableNodeType>, next: NodeProps<TableNodeType>): boolean {
  if (prev.id !== next.id || prev.selected !== next.selected) return false;
  const a = prev.data;
  const b = next.data;
  if (a === b) return true;
  return (
    a.table === b.table &&
    a.currentUser === b.currentUser &&
    a.palette === b.palette &&
    a.readOnly === b.readOnly &&
    a.selectedFieldId === b.selectedFieldId &&
    a.remoteSelectedBy === b.remoteSelectedBy &&
    setsEqual(a.refFieldIds, b.refFieldIds)
  );
}

export const TableNode = memo(TableNodeImpl, tableNodePropsAreEqual);
