import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { RefCardinality } from "@athanordb/shared";
import { RestoreIcon, SettingsIcon } from "@/components/icons/Icons";
import { EDGE_CHROME_Z } from "@/features/editor/edges/canvasLayers";
import { useTranslation } from "@/i18n/useTranslation";
import { EdgeSettingsPopover } from "./EdgeSettingsPopover";

const ROUND_BTN_CLASS =
  "flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full " +
  "text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text";

export function CardinalityBadge(props: {
  x: number;
  y: number;
  label: string;
  cardinality: RefCardinality;
  onCardinalityChange?: (cardinality: RefCardinality) => void;
  onReverseDirection?: () => void;
  color: string;
  zoom: number;
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  onColorChange: (color: string | undefined) => void;
  showReset: boolean;
  onReset: () => void;
  onDeleteRef?: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}) {
  const { t } = useTranslation();
  const scale = 1 / Math.max(props.zoom, 0.01);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  const togglePopover = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (badgeRef.current) {
      setTriggerRect(badgeRef.current.getBoundingClientRect());
    }
    setPopoverOpen((prev) => !prev);
  };

  return (
    <>
      <div
        ref={badgeRef}
        className="nodrag nopan absolute flex items-center gap-0.5 rounded-full border border-border-strong bg-surface-raised p-[3px] pl-2 shadow-md hover:border-primary/50"
        style={{
          left: 0,
          top: 0,
          transform: `translate(${props.x}px, ${props.y}px) translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          pointerEvents: "auto",
          zIndex: EDGE_CHROME_Z,
        }}
        onContextMenu={props.onContextMenu}
      >
        <button
          type="button"
          onClick={togglePopover}
          className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] font-bold leading-none tracking-[0.02em] hover:bg-surface-hover"
          style={{ color: props.color }}
          data-tooltip={t("edge.settings")}
        >
          <span>{props.label}</span>
        </button>

        <span className="mr-0.5 h-3.5 w-px shrink-0 bg-border" />

        {props.showReset && (
          <button
            type="button"
            className={ROUND_BTN_CLASS}
            onClick={(e) => {
              e.stopPropagation();
              props.onReset();
            }}
            data-tooltip={t("edge.resetPath")}
          >
            <RestoreIcon size={12} />
          </button>
        )}

        <button
          type="button"
          className={`${ROUND_BTN_CLASS}${popoverOpen ? " bg-surface-hover text-text" : ""}`}
          onClick={togglePopover}
          data-tooltip={t("edge.settings")}
        >
          <SettingsIcon size={12} />
        </button>
      </div>

      {popoverOpen && (
        <EdgeSettingsPopover
          cardinality={props.cardinality}
          onCardinalityChange={props.onCardinalityChange}
          onReverseDirection={props.onReverseDirection}
          color={props.color}
          onColorChange={props.onColorChange}
          palette={props.palette}
          onPaletteChange={props.onPaletteChange}
          onResetRouting={props.onReset}
          onDeleteRef={props.onDeleteRef}
          triggerRect={triggerRect}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </>
  );
}
