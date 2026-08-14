import { memo, useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { MAX_NAME_LENGTH, type Zone } from "@athanordb/shared";
import { ColorSwatchPicker } from "@/components/inputs/ColorSwatchPicker";
import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
import { useDraftValue } from "@/hooks/useDraftValue";
import { useTranslation } from "@/i18n/useTranslation";

export interface ZoneNodeData {
  zone: Zone;
  palette: string[];
  /** True for a `view` grant — every editing affordance on this node is withheld. */
  readOnly?: boolean;
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
  const draft = useDraftValue(zone.label, (next) => data.onLabelChange(next ?? ""));
  const color = zone.style?.color ?? DEFAULT_COLOR;

  return (
    <>
      <NodeResizer
        minWidth={80}
        minHeight={80}
        isVisible={selected && !data.readOnly}
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
        onDoubleClick={() => {
          if (!data.readOnly) setEditing(true);
        }}
      >
        <div className="absolute left-2.5 top-2 flex items-center gap-1.5">
          {editing ? (
            <input
              autoFocus
              className={`nodrag ${INPUT_XS_CLASS} text-[calc(12.5px_*_var(--canvas-font-scale))] font-bold`}
              value={draft.value}
              onChange={(event) => draft.setValue(event.target.value)}
              onBlur={() => {
                draft.commit();
                setEditing(false);
              }}
              maxLength={MAX_NAME_LENGTH}
              onKeyDown={(event) => {
                draft.handleKeyDown(event);
                if (event.key === "Enter") setEditing(false);
                if (event.key === "Escape") {
                  draft.setValue(zone.label);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <span
              className="text-[calc(12.5px_*_var(--canvas-font-scale))] font-bold tracking-[-0.01em]"
              style={{ color }}
              data-tooltip={data.readOnly ? undefined : t("node.doubleClickToRename")}
            >
              {zone.label}
            </span>
          )}
          {!data.readOnly && (
            <ColorSwatchPicker
              value={color}
              onChange={data.onColorChange}
              palette={data.palette}
              onPaletteChange={data.onPaletteChange}
              triggerClassName="h-[15px] w-[15px] cursor-pointer rounded-full border-[1.5px] border-white/80 bg-none p-0 shadow-xs"
              tooltip={t("zone.color")}
            />
          )}
        </div>
      </div>
    </>
  );
}

export const ZoneNode = memo(ZoneNodeImpl);
