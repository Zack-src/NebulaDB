import { useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { RefCardinality } from "@athanordb/shared";
import { CloseIcon, RestoreIcon, TrashIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { ColorSwatchPicker } from "@/components/inputs/ColorSwatchPicker";
import { useAnchoredPlacement } from "@/hooks/useMenuPlacement";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";
import { useTranslation } from "@/i18n/useTranslation";
import { EDGE_MENU_ATTRIBUTE } from "./useEdgeRouting";

export interface EdgeSettingsPopoverProps {
  cardinality: RefCardinality;
  onCardinalityChange?: (cardinality: RefCardinality) => void;
  color?: string;
  onColorChange: (color: string | undefined) => void;
  palette: string[];
  onPaletteChange: (palette: string[]) => void;
  onResetRouting: () => void;
  onDeleteRef?: () => void;
  triggerRect: DOMRect | null;
  onClose: () => void;
}

export function EdgeSettingsPopover({
  cardinality,
  onCardinalityChange,
  color,
  onColorChange,
  palette,
  onPaletteChange,
  onResetRouting,
  onDeleteRef,
  triggerRect,
  onClose,
}: EdgeSettingsPopoverProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  useDismissablePopover(Boolean(triggerRect), dismiss, [popoverRef]);
  const placement = useAnchoredPlacement(triggerRect, popoverRef);

  if (!triggerRect) return null;

  return createPortal(
    <div
      ref={popoverRef}
      {...{ [EDGE_MENU_ATTRIBUTE]: "" }}
      className="fixed z-[var(--z-popover)] flex w-[320px] flex-col gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 shadow-xl nodrag nopan"
      style={placement ?? { left: triggerRect.left, top: triggerRect.bottom + 6, visibility: "hidden" }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-full border border-white/20"
            style={{ backgroundColor: color ?? "#818cf8" }}
          />
          <span className="text-xs font-semibold text-text">{t("edge.settingsTitle")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      {/* Section 1: Cardinalité avec texte explicatif en langage clair */}
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {t("edge.cardinality")}
        </label>
        <div className="flex flex-col gap-1.5">
          {/* 1 - n */}
          <button
            type="button"
            disabled={!onCardinalityChange}
            onClick={() => onCardinalityChange?.("one-to-many")}
            className={`flex flex-col items-start gap-1 rounded-md border p-2 text-left transition-all ${
              cardinality === "one-to-many"
                ? "border-primary bg-primary-light/30 ring-1 ring-primary"
                : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-semibold text-text">{t("edge.cardinality.oneToMany")}</span>
              <span className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-primary">
                1 : *
              </span>
            </div>
            <p className="text-[11px] leading-snug text-text-secondary">
              {t("edge.cardinality.oneToManyDesc")}
            </p>
          </button>

          {/* 1 - 1 */}
          <button
            type="button"
            disabled={!onCardinalityChange}
            onClick={() => onCardinalityChange?.("one-to-one")}
            className={`flex flex-col items-start gap-1 rounded-md border p-2 text-left transition-all ${
              cardinality === "one-to-one"
                ? "border-primary bg-primary-light/30 ring-1 ring-primary"
                : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-semibold text-text">{t("edge.cardinality.oneToOne")}</span>
              <span className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-[#818cf8]">
                1 : 1
              </span>
            </div>
            <p className="text-[11px] leading-snug text-text-secondary">
              {t("edge.cardinality.oneToOneDesc")}
            </p>
          </button>

          {/* n - n */}
          <button
            type="button"
            disabled={!onCardinalityChange}
            onClick={() => onCardinalityChange?.("many-to-many")}
            className={`flex flex-col items-start gap-1 rounded-md border p-2 text-left transition-all ${
              cardinality === "many-to-many"
                ? "border-primary bg-primary-light/30 ring-1 ring-primary"
                : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-semibold text-text">{t("edge.cardinality.manyToMany")}</span>
              <span className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-[#fbbf24]">
                * : *
              </span>
            </div>
            <p className="text-[11px] leading-snug text-text-secondary">
              {t("edge.cardinality.manyToManyDesc")}
            </p>
          </button>
        </div>
      </div>

      {/* Section 2: Couleur de la relation */}
      <div className="flex flex-col gap-2 border-t border-border pt-2.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {t("edge.color")}
        </label>
        <div className="flex items-center gap-2">
          <ColorSwatchPicker
            value={color ?? "#818cf8"}
            onChange={onColorChange}
            palette={palette}
            onPaletteChange={onPaletteChange}
            triggerClassName="h-6 w-6 shrink-0 cursor-pointer rounded-full border border-white/30"
          />
          {color && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onColorChange(undefined)}
              className="text-xs"
            >
              {t("edge.resetColor")}
            </Button>
          )}
        </div>
      </div>

      {/* Section 3: Actions */}
      <div className="flex items-center justify-between border-t border-border pt-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onResetRouting();
            onClose();
          }}
          className="text-xs text-text-secondary hover:text-text"
        >
          <RestoreIcon size={12} />
          <span>{t("edge.resetPathShort")}</span>
        </Button>
        {onDeleteRef && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              onDeleteRef();
              onClose();
            }}
            className="text-xs"
          >
            <TrashIcon size={12} />
            <span>{t("common.delete")}</span>
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}
