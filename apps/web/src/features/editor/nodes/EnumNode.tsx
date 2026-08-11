import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { MAX_NAME_LENGTH, type EnumDef, type EnumValue } from "@athanordb/shared";
import { TagIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
import { useTranslation } from "@/i18n/useTranslation";

export interface EnumNodeData {
  enumDef: EnumDef;
  onRename: (name: string) => void;
  onAddValue: () => void;
  onRenameValue: (valueId: string, name: string) => void;
  onDeleteValue: (valueId: string) => void;
  onReorderValue: (valueId: string, direction: "up" | "down") => void;
  [key: string]: unknown;
}

export type EnumNodeType = Node<EnumNodeData, "enum">;

const ACCENT = "#06b6d4"; // accent-cyan — distinct from tables (primary) and zones (amber)

function EnumValueRow(props: {
  value: EnumValue;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value.name);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== props.value.name) props.onRename(trimmed);
    else setDraft(props.value.name);
  };

  return (
    <div className="group/row flex items-center gap-1 px-2.5 py-1 hover:bg-surface-hover/60">
      <div className="flex shrink-0 flex-col opacity-0 group-hover/row:opacity-100">
        <button
          type="button"
          className="nodrag h-2.5 w-3.5 text-[9px] leading-none text-text-muted hover:text-text disabled:opacity-20"
          disabled={props.isFirst}
          onClick={() => props.onMove("up")}
          data-tooltip={t("enum.moveUp")}
        >
          ▲
        </button>
        <button
          type="button"
          className="nodrag h-2.5 w-3.5 text-[9px] leading-none text-text-muted hover:text-text disabled:opacity-20"
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
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(props.value.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="flex-1 truncate font-mono text-[calc(11.5px_*_var(--canvas-font-scale))] text-text-secondary"
          onDoubleClick={() => setEditing(true)}
          data-tooltip={t("node.doubleClickToRename")}
        >
          {props.value.name}
        </span>
      )}

      <button
        type="button"
        className="nodrag shrink-0 text-text-muted opacity-0 hover:text-danger group-hover/row:opacity-100"
        onClick={props.onDelete}
        data-tooltip={t("enum.deleteValue")}
      >
        <TrashIcon size={11} />
      </button>
    </div>
  );
}

function EnumNodeImpl({ data, selected }: NodeProps<EnumNodeType>) {
  const { t } = useTranslation();
  const { enumDef } = data;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(enumDef.name);

  const commitName = () => {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== enumDef.name) data.onRename(trimmed);
    else setNameDraft(enumDef.name);
  };

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
        onDoubleClick={() => setEditingName(true)}
      >
        <TagIcon size={12} style={{ color: ACCENT }} />
        {editingName ? (
          <input
            autoFocus
            className={`nodrag ${INPUT_XS_CLASS} flex-1 font-bold text-[calc(12px_*_var(--canvas-font-scale))]`}
            value={nameDraft}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitName();
              if (event.key === "Escape") {
                setNameDraft(enumDef.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <span
            className="flex-1 truncate font-bold text-[calc(12px_*_var(--canvas-font-scale))]"
            style={{ color: ACCENT }}
            data-tooltip={t("node.doubleClickToRename")}
          >
            {enumDef.name}
          </span>
        )}
      </div>

      <div className="divide-y divide-border/60 py-0.5">
        {enumDef.values.length === 0 && (
          <div className="px-2.5 py-1.5 text-[calc(11px_*_var(--canvas-font-scale))] italic text-text-muted">{t("enum.empty")}</div>
        )}
        {enumDef.values.map((v, i) => (
          <EnumValueRow
            key={v.id}
            value={v}
            isFirst={i === 0}
            isLast={i === enumDef.values.length - 1}
            onRename={(name) => data.onRenameValue(v.id, name)}
            onDelete={() => data.onDeleteValue(v.id)}
            onMove={(direction) => data.onReorderValue(v.id, direction)}
          />
        ))}
      </div>

      <button
        type="button"
        className="nodrag flex w-full items-center gap-1.5 border-t border-border/60 px-2.5 py-1.5 text-[calc(11px_*_var(--canvas-font-scale))] text-text-muted hover:bg-surface-hover hover:text-text"
        onClick={data.onAddValue}
      >
        <PlusIcon size={11} /> {t("enum.addValue")}
      </button>
    </div>
  );
}

export const EnumNode = memo(EnumNodeImpl);
