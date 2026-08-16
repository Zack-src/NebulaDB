import { InfoIcon, MinimapIcon, RestoreIcon } from "@/components/icons/Icons";
import {
  CANVAS_TOOLBAR_DIVIDER_CLASS,
  CANVAS_TOOLBAR_ICON_BTN_CLASS,
  CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS,
} from "@/components/ui/canvasToolbarStyles";
import { AnimatedToolbarPill } from "@/components/ui/AnimatedToolbarPill";
import { useTranslation } from "@/i18n/useTranslation";
import { ViewModeToggle, type EditorViewMode } from "./ViewModeToggle";

export interface McdToolbarProps {
  viewMode: EditorViewMode;
  onSetViewMode: (mode: EditorViewMode) => void;
  onResetPositions: () => void;
  minimapVisible: boolean;
  onToggleMinimap: () => void;
}

/**
 * The MCD canvas's bottom-centre pill — its own component (rather than
 * inline JSX in `McdCanvas`) mainly so `McdCanvas` stays about *deriving and
 * rendering the graph*, not also owning every button's markup.
 */
export function McdToolbar({
  viewMode,
  onSetViewMode,
  onResetPositions,
  minimapVisible,
  onToggleMinimap,
}: McdToolbarProps) {
  const { t } = useTranslation();

  return (
    <AnimatedToolbarPill pillId="editing-toolbar">
      <ViewModeToggle value={viewMode} onChange={onSetViewMode} />
      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <button
        type="button"
        className={CANVAS_TOOLBAR_ICON_BTN_CLASS}
        onClick={onResetPositions}
        data-tooltip={t("mcd.resetPositions")}
        data-tooltip-pos="top"
        aria-label={t("mcd.resetPositions")}
      >
        <RestoreIcon size={16} />
      </button>
      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <button
        type="button"
        className={`${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${minimapVisible ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : ""}`}
        onClick={onToggleMinimap}
        aria-pressed={minimapVisible}
        data-tooltip={t(minimapVisible ? "canvas.hideMinimap" : "canvas.showMinimap")}
        data-tooltip-pos="top"
        aria-label={t("canvas.toggleMinimap")}
      >
        <MinimapIcon size={16} />
      </button>
      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      {/* Replaces what used to be a permanently-visible banner over the
          canvas — the same information, but on demand instead of competing
          for attention on every frame. */}
      <button
        type="button"
        className={CANVAS_TOOLBAR_ICON_BTN_CLASS}
        data-tooltip={t("mcd.readOnlyNotice")}
        data-tooltip-pos="top"
        aria-label={t("mcd.readOnlyNotice")}
      >
        <InfoIcon size={16} />
      </button>
    </AnimatedToolbarPill>
  );
}
