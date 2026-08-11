import type { MouseEvent as ReactMouseEvent } from "react";
import { ColorSwatchPicker } from "@/components/inputs/ColorSwatchPicker";
import { useTranslation } from "@/i18n/useTranslation";

/** The floating "1–n"/etc. pill at an edge's midpoint — lets you pick a custom highlight color and shows a reset-routing button once the path has been customized. */
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
  onContextMenu: (e: ReactMouseEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="nodrag nopan"
      style={{
        position: "absolute",
        transform: `translate(-50%, -50%) translate(${props.x}px, ${props.y}px)`,
        background: "var(--color-surface-raised)",
        padding: "2px 5px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        color: props.color,
        border: `1px solid ${props.color}`,
        boxShadow: "var(--shadow-xs)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        pointerEvents: "auto",
      }}
      onContextMenu={props.onContextMenu}
    >
      <span>{props.label}</span>
      <ColorSwatchPicker
        value={props.color}
        onChange={props.onColorChange}
        palette={props.palette}
        onPaletteChange={props.onPaletteChange}
        triggerClassName="h-[13px] w-[13px] shrink-0 cursor-pointer rounded-full border-[1.5px] border-current bg-none p-0"
        tooltip="Couleur du lien"
      />
      {props.showReset && (
        <button
          onClick={props.onReset}
          style={{
            background: "transparent",
            border: "none",
            color: props.color,
            cursor: "pointer",
            padding: "0 2px",
            fontSize: 11,
            lineHeight: 1,
          }}
          data-tooltip={t("edge.resetPath")}
        >
          ↻
        </button>
      )}
    </div>
  );
}
