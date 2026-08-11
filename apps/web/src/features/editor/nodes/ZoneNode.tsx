import { memo, useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { MAX_NAME_LENGTH, type Zone } from "@athanordb/shared";
import { ColorSwatchPicker } from "@/components/inputs/ColorSwatchPicker";
import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
import { useTranslation } from "@/i18n/useTranslation";

export interface ZoneNodeData {
  zone: Zone;
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  onLabelChange: (label: string) => void;
  onColorChange: (color: string) => void;
  onResize: (position: { x: number; y: number }, size: { width: number; height: number }) => void;
  [key: string]: unknown;
}

export type ZoneNodeType = Node<ZoneNodeData, "zone">;

const DEFAULT_COLOR = "#f59e0b";

function ZoneNodeImpl({ data, selected }: NodeProps<ZoneNodeType>) {
  const { t } = useTranslation();
  const { zone } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(zone.label);
  const color = zone.style?.color ?? DEFAULT_COLOR;

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== zone.label) data.onLabelChange(trimmed);
    else setDraft(zone.label);
  };

  return (
    <>
      <NodeResizer
        minWidth={80}
        minHeight={80}
        isVisible={selected}
        onResizeEnd={(_, params) =>
          data.onResize({ x: params.x, y: params.y }, { width: params.width, height: params.height })
        }
      />
      <div
        className="relative box-border h-full w-full rounded-lg"
        style={{
          background: `${color}1f`,
          border: `1.5px dashed ${zone.style?.borderColor ?? color}`,
        }}
        onDoubleClick={() => setEditing(true)}
      >
        <div className="absolute left-2.5 top-2 flex items-center gap-1.5">
          {editing ? (
            <input
              autoFocus
              className={`nodrag ${INPUT_XS_CLASS} text-[calc(12.5px_*_var(--canvas-font-scale))] font-bold`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              maxLength={MAX_NAME_LENGTH}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
                if (event.key === "Escape") {
                  setDraft(zone.label);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <span
              className="text-[calc(12.5px_*_var(--canvas-font-scale))] font-bold tracking-[-0.01em]"
              style={{ color }}
              data-tooltip={t("node.doubleClickToRename")}
            >
              {zone.label}
            </span>
          )}
          <ColorSwatchPicker
            value={color}
            onChange={data.onColorChange}
            palette={data.palette}
            onPaletteChange={data.onPaletteChange}
            triggerClassName="h-[15px] w-[15px] cursor-pointer rounded-full border-[1.5px] border-white/80 bg-none p-0 shadow-xs"
            tooltip="Zone color"
          />
        </div>
      </div>
    </>
  );
}

export const ZoneNode = memo(ZoneNodeImpl);
