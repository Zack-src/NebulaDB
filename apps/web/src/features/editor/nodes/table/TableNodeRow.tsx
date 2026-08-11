import { Handle, Position } from "@xyflow/react";
import type { Comment, Field } from "@athanordb/shared";
import { CommentThread } from "@/features/editor/comments/CommentThread";
import { AsteriskIcon, DiamondIcon, IncrementIcon, NoteIcon } from "@/components/icons/Icons";
import { FieldBadge } from "@/features/editor/nodes/table/FieldBadge";
import { FieldEditorPopover } from "@/features/editor/nodes/table/FieldEditorPopover";
import { useTranslation } from "@/i18n/useTranslation";
import {
  KW_BADGE_CLASS,
  KW_BADGE_COLOR,
  ROW_ACTIONS_CLASS,
  ROW_ACTION_BTN_CLASS,
  ROW_BADGES_CLASS,
  ROW_CLASS,
  ROW_TYPE_CLASS,
  rowNameClass,
  rowStateClass,
} from "@/features/editor/nodes/table/tableStyles";

export interface TableNodeRowProps {
  field: Field;
  comments: Comment[];
  isPk: boolean;
  isForeignKey: boolean;
  isLinked: boolean;
  isSelected: boolean;
  currentUser: string;
  onSelect: () => void;
  onAddComment: (text: string) => void;
  onDeleteComment: (commentId: string) => void;
  onUpdateField?: (fieldId: string, updates: Partial<Field>) => void;
  onDeleteField?: (fieldId: string) => void;
}

/** One field row: side handles, badge/name/type, PK/UQ/NN/AI/note badges, and the edit + comment popovers. */
export function TableNodeRow({
  field,
  comments,
  isPk,
  isForeignKey,
  isLinked,
  isSelected,
  currentUser,
  onSelect,
  onAddComment,
  onDeleteComment,
  onUpdateField,
  onDeleteField,
}: TableNodeRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`table-node-row ${ROW_CLASS} ${rowStateClass(isLinked, isSelected)}`}
      // Whole row is the hover target for the column's note — the note icon is
      // a 16px hit area, far too small to be the only way to read it.
      data-tooltip={`${field.name} (${field.type})`}
      {...(field.note ? { "data-tooltip-note": field.note } : {})}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <Handle type="target" position={Position.Left} id={`${field.id}-left-target`} className="table-row-handle" />
      <Handle type="source" position={Position.Left} id={`${field.id}-left-source`} className="table-row-handle" />
      <span className={rowNameClass(isLinked)}>{field.name}</span>
      <FieldBadge isForeignKey={isForeignKey} isPk={isPk} />

      <div className={ROW_BADGES_CLASS}>
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
          onUpdateField={onUpdateField}
          onDeleteField={onDeleteField}
          triggerClassName={ROW_ACTION_BTN_CLASS}
        />
        <CommentThread
          comments={comments}
          currentUser={currentUser}
          onAdd={onAddComment}
          onDelete={onDeleteComment}
          triggerClassName={ROW_ACTION_BTN_CLASS}
          tooltip={t("comments.onField", { field: field.name })}
        />
      </div>

      <span className={ROW_TYPE_CLASS}>{field.type}</span>

      <Handle type="target" position={Position.Right} id={`${field.id}-right-target`} className="table-row-handle" />
      <Handle type="source" position={Position.Right} id={`${field.id}-right-source`} className="table-row-handle" />
    </div>
  );
}
