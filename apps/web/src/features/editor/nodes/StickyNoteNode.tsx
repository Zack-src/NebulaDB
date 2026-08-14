import { memo } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { MAX_TEXT_LENGTH, type StickyNote } from "@athanordb/shared";
import { ColorSwatchPicker } from "@/components/inputs/ColorSwatchPicker";
import { useTranslation } from "@/i18n/useTranslation";

export interface StickyNoteNodeData {
  note: StickyNote;
  palette: string[];
  /** True for a `view` grant — every editing affordance on this node is withheld. */
  readOnly?: boolean;
  onPaletteChange: (palette: string[]) => void;
  onTextChange: (text: string) => void;
  onColorChange: (color: string) => void;
  onResize: (position: { x: number; y: number }, size: { width: number; height: number }) => void;
  [key: string]: unknown;
}

export type StickyNoteNodeType = Node<StickyNoteNodeData, "sticky">;

const DEFAULT_COLOR = "#fef08a";

function StickyNoteNodeImpl({ data, selected }: NodeProps<StickyNoteNodeType>) {
  const { t } = useTranslation();
  const { note } = data;
  const color = note.style?.color ?? DEFAULT_COLOR;

  return (
    <>
      <NodeResizer
        minWidth={100}
        minHeight={80}
        isVisible={selected && !data.readOnly}
        onResizeEnd={(_, params) =>
          data.onResize({ x: params.x, y: params.y }, { width: params.width, height: params.height })
        }
      />
      <div
        className="box-border flex h-full w-full flex-col gap-1.5 rounded-sm p-2 shadow-sm"
        style={{ background: color, border: `1px solid ${note.style?.borderColor ?? "#ca8a04"}` }}
      >
        <textarea
          className="nodrag flex-1 resize-none border-0 bg-transparent text-[calc(12.5px_*_var(--canvas-font-scale))] leading-[1.4] text-text-onlight outline-hidden placeholder:text-[rgba(35,37,42,0.45)] read-only:cursor-default"
          value={note.text}
          readOnly={data.readOnly}
          onChange={(event) => data.onTextChange(event.target.value)}
          placeholder={data.readOnly ? "" : t("stickyNote.placeholder")}
          maxLength={MAX_TEXT_LENGTH}
        />
        {!data.readOnly && (
          <div className="flex justify-end">
            <ColorSwatchPicker
              value={color}
              onChange={data.onColorChange}
              palette={data.palette}
              onPaletteChange={data.onPaletteChange}
              triggerClassName="h-[15px] w-[15px] cursor-pointer rounded-full border-[1.5px] border-black/15 bg-none p-0"
              tooltip={t("stickyNote.color")}
            />
          </div>
        )}
      </div>
    </>
  );
}

export const StickyNoteNode = memo(StickyNoteNodeImpl);
