import { Panel } from "@xyflow/react";
import { LayersIcon } from "@/components/icons/Icons";
import { SWATCH_CELL_CLASS } from "@/components/inputs/ColorSwatchPicker";
import { useTranslation } from "@/i18n/useTranslation";

export interface SelectionColorToolbarProps {
  count: number;
  palette: string[];
  onPick: (color: string) => void;
  onGroup: () => void;
}

/**
 * Floating swatch row shown above the canvas once 2+ tables are selected —
 * picking a colour applies it to every selected table's header at once, and
 * "group" bundles them into a named table group.
 */
export function SelectionColorToolbar({ count, palette, onPick, onGroup }: SelectionColorToolbarProps) {
  const { t } = useTranslation();

  return (
    <Panel position="top-center" className="nodrag nopan">
      <div className="flex flex-col items-start gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-2 shadow-lg">
        <div className="flex w-full items-center justify-between gap-3">
          <span className="whitespace-nowrap text-xs text-text-muted">
            {t("canvas.selection.tablesSelected", { count })}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 whitespace-nowrap rounded-md border border-border-strong/80 px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary hover:border-primary/60 hover:text-text"
            onClick={onGroup}
            data-tooltip={t("canvas.selection.groupTooltip")}
          >
            <LayersIcon size={12} /> {t("canvas.selection.group")}
          </button>
        </div>
        <div className="grid grid-cols-10 gap-1.5">
          {palette.map((color) => (
            <button
              key={color}
              type="button"
              className={SWATCH_CELL_CLASS}
              style={{ background: color }}
              onClick={() => onPick(color)}
              data-tooltip={color}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}
