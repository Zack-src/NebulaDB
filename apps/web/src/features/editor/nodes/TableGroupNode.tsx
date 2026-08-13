import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { MAX_NAME_LENGTH, type TableGroup } from "@athanordb/shared";
import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
import { useDraftValue } from "@/hooks/useDraftValue";
import { useTranslation } from "@/i18n/useTranslation";

export interface TableGroupNodeData {
  group: TableGroup;
  memberCount: number;
  onRename: (name: string) => void;
  onUngroup: () => void;
  [key: string]: unknown;
}

export type TableGroupNodeType = Node<TableGroupNodeData, "tablegroup">;

const ACCENT = "#a855f7"; // accent-purple — distinct from zones (amber) and enums (cyan)

/**
 * A dashed outline around a group's member tables, purely derived —
 * `useCanvasNodes` computes this node's position/size from wherever its
 * member tables currently sit (see the sizing comment there), so unlike
 * Zone there's nothing to drag or resize here: `draggable: false` and the
 * box itself is `pointer-events: none` so clicks fall through to whatever
 * table is actually underneath. Only the label pill is interactive.
 */
function TableGroupNodeImpl({ data }: NodeProps<TableGroupNodeType>) {
  const { t } = useTranslation();
  const { group } = data;
  const [editing, setEditing] = useState(false);
  const draft = useDraftValue(group.name, (next) => data.onRename(next ?? ""));

  return (
    <div className="pointer-events-none relative h-full w-full">
      <div
        className="absolute inset-0 rounded-xl"
        style={{ border: `1.5px dashed ${ACCENT}70`, background: `${ACCENT}0a` }}
      />
      <div className="pointer-events-auto absolute -top-3 left-3 flex items-center gap-1.5 rounded-full border px-2 py-0.5 shadow-sm" style={{ background: "var(--color-surface)", borderColor: `${ACCENT}80` }}>
        {editing ? (
          <input
            autoFocus
            className={`nodrag ${INPUT_XS_CLASS} h-[20px] text-[11px] font-bold`}
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
                draft.setValue(group.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="text-[11px] font-bold"
            style={{ color: ACCENT }}
            onDoubleClick={() => setEditing(true)}
            data-tooltip={t("node.doubleClickToRename")}
          >
            {group.name} · {data.memberCount}
          </span>
        )}
        <button
          type="button"
          className="nodrag text-[13px] leading-none text-text-muted hover:text-danger"
          onClick={data.onUngroup}
          data-tooltip={t("tableGroup.ungroup")}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export const TableGroupNode = memo(TableGroupNodeImpl);
