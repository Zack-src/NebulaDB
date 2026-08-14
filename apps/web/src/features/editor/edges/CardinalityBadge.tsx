import type { MouseEvent as ReactMouseEvent } from "react";
import { RestoreIcon, SettingsIcon } from "@/components/icons/Icons";
import { ColorSwatchPicker } from "@/components/inputs/ColorSwatchPicker";
import { EDGE_CHROME_Z } from "@/features/editor/edges/canvasLayers";
import { useTranslation } from "@/i18n/useTranslation";

const ROUND_BTN_CLASS =
  "flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full " +
  "text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text";

/**
 * The floating toolbar at a selected edge's midpoint — dbdiagram-style: the
 * cardinality pill plus a row of small circular action buttons (reset path,
 * settings) rather than text glyphs crammed into the pill itself. Only
 * mounted while the edge is selected, same as its waypoint dots — an
 * unselected schema shouldn't be covered in editing chrome.
 *
 * Counter-scaled against the viewport zoom: the edge-label layer is inside
 * React Flow's transform, so without this the 22px hit targets shrink with the
 * diagram and become unclickable at the zoom levels where you actually want to
 * re-route a line.
 */
export function CardinalityBadge(props: {
  x: number;
  y: number;
  label: string;
  color: string;
  zoom: number;
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  onColorChange: (color: string | undefined) => void;
  showReset: boolean;
  onReset: () => void;
  onOpenSettings: (e: ReactMouseEvent) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}) {
  const { t } = useTranslation();
  const scale = 1 / Math.max(props.zoom, 0.01);

  return (
    <div
      className="nodrag nopan absolute flex items-center gap-0.5 rounded-full border border-border-strong bg-surface-raised p-[3px] pl-1.5 shadow-md"
      style={{
        transform: `translate(-50%, -50%) translate(${props.x}px, ${props.y}px) scale(${scale})`,
        pointerEvents: "auto",
        // React Flow paints nodes after the edge-label layer and lifts the
        // selected one to 1000, so without this the toolbar vanishes under any
        // table the relation happens to cross.
        zIndex: EDGE_CHROME_Z,
      }}
      onContextMenu={props.onContextMenu}
    >
      <span className="mr-0.5 text-[11px] font-bold leading-none tracking-[0.02em]" style={{ color: props.color }}>
        {props.label}
      </span>
      <span className="mr-0.5 h-3.5 w-px shrink-0 bg-border" />
      <ColorSwatchPicker
        value={props.color}
        onChange={props.onColorChange}
        palette={props.palette}
        onPaletteChange={props.onPaletteChange}
        triggerClassName="h-[14px] w-[14px] shrink-0 cursor-pointer rounded-full border border-white/25 p-0"
        tooltip={t("edge.color")}
      />
      {props.showReset && (
        <button type="button" className={ROUND_BTN_CLASS} onClick={props.onReset} data-tooltip={t("edge.resetPath")}>
          <RestoreIcon size={12} />
        </button>
      )}
      <button
        type="button"
        className={ROUND_BTN_CLASS}
        onClick={props.onOpenSettings}
        data-tooltip={t("edge.settings")}
      >
        <SettingsIcon size={12} />
      </button>
    </div>
  );
}
