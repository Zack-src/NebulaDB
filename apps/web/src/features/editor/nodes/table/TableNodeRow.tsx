import { forwardRef, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { MAX_NAME_LENGTH, type Comment, type Field } from "@athanordb/shared";
import { CommentThread } from "@/features/editor/comments/CommentThread";
import { AsteriskIcon, DiamondIcon, GripVerticalIcon, IncrementIcon, NoteIcon } from "@/components/icons/Icons";
import { FieldBadge } from "@/features/editor/nodes/table/FieldBadge";
import { FieldEditorPopover } from "@/features/editor/nodes/table/FieldEditorPopover";
import { useDraftValue } from "@/hooks/useDraftValue";
import { useTranslation } from "@/i18n/useTranslation";
import {
  KW_BADGE_CLASS,
  KW_BADGE_COLOR,
  ROW_ACTIONS_CLASS,
  ROW_ACTION_BTN_CLASS,
  ROW_BADGES_CLASS,
  ROW_CLASS,
  ROW_DRAG_HANDLE_CLASS,
  ROW_NAME_INPUT_CLASS,
  ROW_TYPE_CLASS,
  rowDropIndicatorClass,
  rowNameClass,
  rowStateClass,
} from "@/features/editor/nodes/table/tableStyles";

/** Custom drag MIME so a column drag is never mistaken for some other drag-and-drop the browser/OS might offer over the canvas (e.g. dropping a file). */
const FIELD_DRAG_MIME = "application/x-athanordb-field";

export interface TableNodeRowProps {
  field: Field;
  comments: Comment[];
  isPk: boolean;
  isForeignKey: boolean;
  isLinked: boolean;
  isSelected: boolean;
  currentUser: string;
  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onAddComment: (text: string) => void;
  onDeleteComment: (commentId: string) => void;
  onUpdateField?: (fieldId: string, updates: Partial<Field> | ((current: Field) => Partial<Field>)) => void;
  onDeleteField?: (fieldId: string) => void;
  onReorderField?: (draggedFieldId: string, targetFieldId: string, before: boolean) => void;
}

/**
 * One field row: side handles, badge/name/type, PK/UQ/NN/AI/note badges, and
 * the edit + comment popovers.
 *
 * Forwards its root ref — `TableNode` attaches it only to whichever row is
 * currently selected, so it can tell a click on that row apart from a click
 * anywhere else and clear the selection accordingly.
 */
export const TableNodeRow = forwardRef<HTMLDivElement, TableNodeRowProps>(function TableNodeRow(
  {
    field,
    comments,
    isPk,
    isForeignKey,
    isLinked,
    isSelected,
    currentUser,
    onSelect,
    onHoverStart,
    onHoverEnd,
    onAddComment,
    onDeleteComment,
    onUpdateField,
    onDeleteField,
    onReorderField,
  },
  ref,
) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const nameDraft = useDraftValue(field.name, (next) => onUpdateField?.(field.id, { name: next ?? "" }));
  // Which side of this row a dragged-over column would land on — null when
  // nothing's being dragged over it right now. Local, not lifted: only the
  // row currently under the pointer needs to know.
  const [dropSide, setDropSide] = useState<"before" | "after" | null>(null);

  // Guards the unmount cleanup below: only a row that is itself the currently
  // hovered one should clear the shared hover state when it disappears (a
  // field deleted, or panned out of view under `onlyRenderVisibleElements`
  // mid-hover) — an unrelated row unmounting must not clear someone else's.
  const isHoveredRef = useRef(false);
  useEffect(
    () => () => {
      if (isHoveredRef.current) onHoverEnd();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div
      ref={ref}
      className={`table-node-row ${ROW_CLASS} ${rowStateClass(isLinked, isSelected)} ${rowDropIndicatorClass(dropSide)}`}
      // Whole row is the hover target for the column's note — the note icon is
      // a 16px hit area, far too small to be the only way to read it.
      data-tooltip={`${field.name} (${field.type})`}
      {...(field.note ? { "data-tooltip-note": field.note } : {})}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => {
        isHoveredRef.current = true;
        onHoverStart();
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
        onHoverEnd();
      }}
      onDragOver={(event) => {
        if (!onReorderField || !event.dataTransfer.types.includes(FIELD_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        setDropSide(event.clientY < rect.top + rect.height / 2 ? "before" : "after");
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(event) => {
        if (!onReorderField || !event.dataTransfer.types.includes(FIELD_DRAG_MIME)) return;
        event.preventDefault();
        const draggedFieldId = event.dataTransfer.getData(FIELD_DRAG_MIME);
        if (draggedFieldId && draggedFieldId !== field.id) {
          onReorderField(draggedFieldId, field.id, dropSide !== "after");
        }
        setDropSide(null);
      }}
    >
      <Handle type="target" position={Position.Left} id={`${field.id}-left-target`} className="table-row-handle" />
      <Handle type="source" position={Position.Left} id={`${field.id}-left-source`} className="table-row-handle" />
      {onReorderField && (
        <span
          className={`nodrag ${ROW_DRAG_HANDLE_CLASS}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(FIELD_DRAG_MIME, field.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onClick={(event) => event.stopPropagation()}
          data-tooltip={t("field.dragToReorder")}
        >
          <GripVerticalIcon size={12} />
        </span>
      )}
      {renaming ? (
        <input
          autoFocus
          className={`nodrag ${ROW_NAME_INPUT_CLASS}`}
          value={nameDraft.value}
          onChange={(event) => nameDraft.setValue(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => {
            nameDraft.commit();
            setRenaming(false);
          }}
          maxLength={MAX_NAME_LENGTH}
          onKeyDown={(event) => {
            event.stopPropagation();
            nameDraft.handleKeyDown(event);
            if (event.key === "Enter") setRenaming(false);
            if (event.key === "Escape") {
              nameDraft.setValue(field.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <span
          className={rowNameClass(isLinked)}
          onDoubleClick={(event) => {
            if (!onUpdateField) return;
            event.stopPropagation();
            setRenaming(true);
          }}
        >
          {field.name}
        </span>
      )}

      <div className={ROW_BADGES_CLASS}>
        <FieldBadge isForeignKey={isForeignKey} isPk={isPk} />
        {field.unique && (
          <span className={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.unique}`} data-tooltip={t("field.unique")}>
            <DiamondIcon size={16} />
          </span>
        )}
        {field.notNull && (
          <span className={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.notNull}`} data-tooltip={t("field.notNull")}>
            <AsteriskIcon size={16} />
          </span>
        )}
        {field.increment && (
          <span className={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.increment}`} data-tooltip={t("field.increment")}>
            <IncrementIcon size={16} />
          </span>
        )}
        {field.note && (
          <span
            className={`${KW_BADGE_CLASS} ${KW_BADGE_COLOR.note}`}
            data-tooltip={`${field.name} — note`}
            data-tooltip-note={field.note}
          >
            <NoteIcon size={16} />
          </span>
        )}
      </div>

      <div className={ROW_ACTIONS_CLASS}>
        <FieldEditorPopover
          field={field}
          comments={comments}
          currentUser={currentUser}
          onUpdateField={onUpdateField}
          onDeleteField={onDeleteField}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          triggerClassName={ROW_ACTION_BTN_CLASS}
        />
        {/* Only an indicator once a comment actually exists — not a standing
            invitation to add one on every column. Adding the first comment
            happens from the field's own properties (above) instead. */}
        {comments.length > 0 && (
          <CommentThread
            comments={comments}
            currentUser={currentUser}
            onAdd={onAddComment}
            onDelete={onDeleteComment}
            triggerClassName={ROW_ACTION_BTN_CLASS}
            tooltip={t("comments.onField", { field: field.name })}
          />
        )}
      </div>

      <span className={ROW_TYPE_CLASS}>{field.type}</span>

      <Handle type="target" position={Position.Right} id={`${field.id}-right-target`} className="table-row-handle" />
      <Handle type="source" position={Position.Right} id={`${field.id}-right-source`} className="table-row-handle" />
    </div>
  );
});
