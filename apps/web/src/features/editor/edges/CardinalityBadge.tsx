import type { MouseEvent as ReactMouseEvent } from "react";
import { RestoreIcon, SettingsIcon } from "@/components/icons/Icons";
import { ColorSwatchPicker } from "@/components/inputs/ColorSwatchPicker";
import { useTranslation } from "@/i18n/useTranslation";

const ROUND_BTN_CLASS =
  "flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border bg-surface-raised shadow-xs hover:brightness-125";

/**
 * The floating toolbar at a selected edge's midpoint — dbdiagram-style: the
 * cardinality pill plus a row of small circular action buttons (reset path,
 * settings) rather than text glyphs crammed into the pill itself. Only
 * mounted while the edge is selected, same as its waypoint dots — an
 * unselected schema shouldn't be covered in editing chrome.
 */
export function CardinalityBadge(props: {
  x: number;
  y: number;
  label: string;
  color: string;
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  onColorChange: (color: string | undefined) => void;
  showReset: boolean;
  onReset: () => void;
  onOpenSettings: (e: ReactMouseEvent) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="nodrag nopan flex items-center gap-1"
      style={{
        position: "absolute",
        transform: `translate(-50%, -50%) translate(${props.x}px, ${props.y}px)`,
        pointerEvents: "auto",
      }}
      onContextMenu={props.onContextMenu}
    >
      <span
        style={{
          background: "var(--color-surface-raised)",
          padding: "2px 7px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 700,
          color: props.color,
          border: `1px solid ${props.color}`,
          boxShadow: "var(--shadow-xs)",
        }}
      >
        {props.label}
      </span>
      <ColorSwatchPicker
        value={props.color}
        onChange={props.onColorChange}
        palette={props.palette}
        onPaletteChange={props.onPaletteChange}
        triggerClassName="h-[15px] w-[15px] shrink-0 cursor-pointer rounded-full border-[1.5px] border-current bg-none p-0"
        tooltip="Couleur du lien"
      />
      {props.showReset && (
        <button
          type="button"
          className={ROUND_BTN_CLASS}
          style={{ borderColor: props.color, color: props.color }}
          onClick={props.onReset}
          data-tooltip={t("edge.resetPath")}
        >
          <RestoreIcon size={10} />
        </button>
      )}
      <button
        type="button"
        className={ROUND_BTN_CLASS}
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
        onClick={props.onOpenSettings}
        data-tooltip={t("edge.settings")}
      >
        <SettingsIcon size={10} />
      </button>
    </div>
  );
}
