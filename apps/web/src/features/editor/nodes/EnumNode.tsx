import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { MAX_NAME_LENGTH, type EnumDef, type EnumValue } from "@athanordb/shared";
import { TagIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
import { useDraftValue } from "@/hooks/useDraftValue";
import { useTranslation } from "@/i18n/useTranslation";

export interface EnumNodeData {
  enumDef: EnumDef;
  /** True for a `view` grant — every editing affordance on this node is withheld. */
  readOnly?: boolean;
  onRename: (name: string) => void;
  onAddValue: () => void;
  onRenameValue: (valueId: string, name: string) => void;
  onDeleteValue: (valueId: string) => void;
  onReorderValue: (valueId: string, direction: "up" | "down") => void;
  [key: string]: unknown;
}

export type EnumNodeType = Node<EnumNodeData, "enum">;

const ACCENT = "#06b6d4"; // accent-cyan — distinct from tables (primary) and zones (amber)

/**
 * The glyph stays tiny — two of these stack inside one 24px row — but the
 * *target* is widened with a pseudo-element, so the pointer has something to
 * hit. At `h-2.5 w-3.5` these were a 10x14px target, well under any usable
 * minimum.
 */
const REORDER_BTN_CLASS =
  "nodrag relative flex h-3 w-4 items-center justify-center text-[9px] leading-none text-text-muted " +
  "transition-colors hover:text-text disabled:opacity-20 " +
  "before:absolute before:left-1/2 before:top-1/2 before:h-5 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

function EnumValueRow(props: {
  value: EnumValue;
  isFirst: boolean;
  isLast: boolean;
  readOnly: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const draft = useDraftValue(props.value.name, (next) => props.onRename(next ?? ""));

  return (
    <div className="group/row flex items-center gap-1 px-2.5 py-1 hover:bg-surface-hover/60">
      <div className={`flex shrink-0 flex-col opacity-0 ${props.readOnly ? "" : "group-hover/row:opacity-100"}`}>
        <button
          type="button"
          className={REORDER_BTN_CLASS}
          disabled={props.isFirst}
          onClick={() => props.onMove("up")}
          data-tooltip={t("enum.moveUp")}
        >
          ▲
        </button>
        <button
          type="button"
          className={REORDER_BTN_CLASS}
          disabled={props.isLast}
          onClick={() => props.onMove("down")}
          data-tooltip={t("enum.moveDown")}
        >
          ▼
        </button>
      </div>

      {editing ? (
        <input
          autoFocus
          className={`nodrag ${INPUT_XS_CLASS} flex-1 font-mono text-[calc(11.5px_*_var(--canvas-font-scale))]`}
          value={draft.value}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => draft.setValue(event.target.value)}
          onBlur={() => {
            draft.commit();
            setEditing(false);
          }}
          onKeyDown={(event) => {
            draft.handleKeyDown(event);
            if (event.key === "Enter") setEditing(false);
            if (event.key === "Escape") {
              draft.setValue(props.value.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="flex-1 truncate font-mono text-[calc(11.5px_*_var(--canvas-font-scale))] text-text-secondary"
          onDoubleClick={() => {
            if (!props.readOnly) setEditing(true);
          }}
          data-tooltip={props.readOnly ? undefined : t("node.doubleClickToRename")}
        >
          {props.value.name}
        </span>
      )}

      {!props.readOnly && (
        <button
          type="button"
          className="nodrag shrink-0 text-text-muted opacity-0 transition-colors hover:text-danger group-hover/row:opacity-100"
          onClick={props.onDelete}
          data-tooltip={t("enum.deleteValue")}
          aria-label={t("enum.deleteValue")}
        >
          <TrashIcon size={11} />
        </button>
      )}
    </div>
  );
}

function EnumNodeImpl({ data, selected }: NodeProps<EnumNodeType>) {
  const { t } = useTranslation();
  const { enumDef } = data;
  const readOnly = Boolean(data.readOnly);
  const [editingName, setEditingName] = useState(false);
  const nameDraft = useDraftValue(enumDef.name, (next) => data.onRename(next ?? ""));

  return (
    <div
      className={`w-[200px] overflow-hidden rounded-lg border bg-surface shadow-md transition-shadow ${
        selected ? "shadow-lg" : ""
      }`}
      style={{ borderColor: selected ? ACCENT : "var(--color-border)" }}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{ background: `${ACCENT}22`, borderBottom: `1px solid ${ACCENT}55` }}
        onDoubleClick={() => {
          if (!readOnly) setEditingName(true);
        }}
      >
        <TagIcon size={12} style={{ color: ACCENT }} />
        {editingName ? (
          <input
            autoFocus
            className={`nodrag ${INPUT_XS_CLASS} flex-1 font-bold text-[calc(12px_*_var(--canvas-font-scale))]`}
            value={nameDraft.value}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => nameDraft.setValue(event.target.value)}
            onBlur={() => {
              nameDraft.commit();
              setEditingName(false);
            }}
            onKeyDown={(event) => {
              nameDraft.handleKeyDown(event);
              if (event.key === "Enter") setEditingName(false);
              if (event.key === "Escape") {
                nameDraft.setValue(enumDef.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <span
            className="flex-1 truncate font-bold text-[calc(12px_*_var(--canvas-font-scale))]"
            style={{ color: ACCENT }}
            data-tooltip={readOnly ? undefined : t("node.doubleClickToRename")}
          >
            {enumDef.name}
          </span>
        )}
      </div>

      <div className="divide-y divide-border/60 py-0.5">
        {enumDef.values.length === 0 && (
          <div className="px-2.5 py-1.5 text-[calc(11px_*_var(--canvas-font-scale))] italic text-text-muted">
            {t("enum.empty")}
          </div>
        )}
        {enumDef.values.map((v, i) => (
          <EnumValueRow
            key={v.id}
            value={v}
            isFirst={i === 0}
            isLast={i === enumDef.values.length - 1}
            readOnly={readOnly}
            onRename={(name) => data.onRenameValue(v.id, name)}
            onDelete={() => data.onDeleteValue(v.id)}
            onMove={(direction) => data.onReorderValue(v.id, direction)}
          />
        ))}
      </div>

      {!readOnly && (
        <button
          type="button"
          className="nodrag flex w-full items-center gap-1.5 border-t border-border/60 px-2.5 py-1.5 text-[calc(11px_*_var(--canvas-font-scale))] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          onClick={data.onAddValue}
        >
          <PlusIcon size={11} /> {t("enum.addValue")}
        </button>
      )}
    </div>
  );
}

export const EnumNode = memo(EnumNodeImpl);
