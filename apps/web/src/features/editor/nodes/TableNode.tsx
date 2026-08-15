import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type Node, type NodeProps, type ReactFlowState } from "@xyflow/react";
import { MAX_NAME_LENGTH, type Field, type Table, type TableIndex } from "@athanordb/shared";
import { CommentThread } from "@/features/editor/comments/CommentThread";
import type { RemoteSelector } from "@/features/collaboration/useRemoteSelections";
import { CodeIcon, PlusIcon } from "@/components/icons/Icons";
import { DEFAULT_HEADER_COLOR, TableSettingsPopover } from "@/features/editor/nodes/table/TableSettingsPopover";
import { TableNodeRow } from "@/features/editor/nodes/table/TableNodeRow";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";
import { useDraftValue } from "@/hooks/useDraftValue";
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
  highlightLinks?: boolean;
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
  onUpdateField?: (fieldId: string, updates: Partial<Field>) => void;
  onAddField?: (field: Omit<Field, "id">) => void;
  onDeleteField?: (fieldId: string) => void;
  onAddIndex?: (fieldIds: string[], opts: { unique?: boolean; pk?: boolean; name?: string }) => void;
  onUpdateIndex?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
  onDeleteIndex?: (indexId: string) => void;
  [key: string]: unknown;
}

export type TableNodeType = Node<TableNodeData, "table">;

/** `fieldId-left-source` -> `fieldId`. Hoisted so the pattern is compiled once rather than per edge per node. */
const HANDLE_SUFFIX = /-(left|right)-(source|target)$/;
const stripHandleSuffix = (handle: string) => handle.replace(HANDLE_SUFFIX, "");

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
      setNodes((nds) =>
        nds.map((n) => (n.id === id || n.selected ? { ...n, selected: false } : n)),
      );
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
   * Selected through the store into a *string*, not through `useEdges()`.
   * Subscribing to the whole edge array re-rendered every table node on every
   * edge change — including each frame of a drag — while the answer for this
   * table almost never differs. A joined primitive compares with `===`, so a
   * node only re-renders when its own set of linked columns actually changes.
   */
  const linkedFieldKey = useStore(
    useCallback(
      (state: ReactFlowState) => {
        const ids: string[] = [];
        for (const edge of state.edges) {
          if (!edge.selected && !edge.data?.connectedHighlight) continue;
          if (edge.source === table.id && edge.sourceHandle) ids.push(stripHandleSuffix(edge.sourceHandle));
          if (edge.target === table.id && edge.targetHandle) ids.push(stripHandleSuffix(edge.targetHandle));
        }
        return ids.sort().join("|");
      },
      [table.id],
    ),
  );
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
  const isPkField = (field: Field) => field.pk || pkIndexFieldIds.has(field.id);

  const rows =
    table.detailLevel === "compact"
      ? []
      : table.detailLevel === "full"
        ? table.fields
        : table.fields.filter((f) => isPkField(f) || refFieldIds.has(f.id));

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
        style={{ background: headerColor, color: prefersDarkText(headerColor) ? "var(--color-text-on-light)" : "#ffffff" }}
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
          isLinked={Boolean(
            (data.highlightLinks && refFieldIds.has(field.id)) ||
              selectedEdgeFieldIds.has(field.id) ||
              (selectedFieldId === field.id && refFieldIds.has(field.id)),
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
                type: "varchar",
              });
            }}
            data-tooltip={t("table.addColumnTooltip")}
          >
            <PlusIcon size={12} /> {t("table.addColumn")}
          </button>
        </div>
      )}
    </div>
  );
}

export const TableNode = memo(TableNodeImpl);
