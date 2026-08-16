import { useTranslation } from "@/i18n/useTranslation";
import { CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS, CANVAS_TOOLBAR_SEGMENT_CLASS } from "@/components/ui/canvasToolbarStyles";

export type EditorViewMode = "mld" | "mcd";

/**
 * MLD/MCD switch — a pair of segments meant to sit *inside* `CanvasToolbar`
 * (and the MCD canvas's own equivalent pill), not floated on its own: it's
 * the same toolbar family as `DetailLevelDropdown`, just two always-visible
 * options instead of a popover, since there are only two.
 */
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: EditorViewMode;
  onChange: (mode: EditorViewMode) => void;
}) {
  const { t } = useTranslation();

  const option = (mode: EditorViewMode, label: string, hint: string) => (
    <button
      type="button"
      className={`${CANVAS_TOOLBAR_SEGMENT_CLASS} ${value === mode ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
      onClick={() => onChange(mode)}
      aria-pressed={value === mode}
      data-tooltip={hint}
      data-tooltip-pos="top"
    >
      {label}
    </button>
  );

  return (
    <>
      {option("mld", t("canvas.view.mld"), t("canvas.view.mldHint"))}
      {option("mcd", t("canvas.view.mcd"), t("canvas.view.mcdHint"))}
    </>
  );
}
