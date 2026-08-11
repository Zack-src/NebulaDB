import { useReactFlow, useStore } from "@xyflow/react";
import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
import {
  CANVAS_TOOLBAR_CLASS,
  CANVAS_TOOLBAR_DIVIDER_CLASS,
  CANVAS_TOOLBAR_ICON_BTN_CLASS,
  CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS,
  CANVAS_TOOLBAR_SEGMENT_CLASS,
} from "@/components/ui/canvasToolbarStyles";
import { LayoutGridIcon } from "@/components/icons/Icons";
import { useTranslation } from "@/i18n/useTranslation";
import { ToolbarMenu } from "./ToolbarMenu";

const ZOOM_PRESETS = [0.5, 1, 2] as const;
/** Key combination, not prose — never translated. */
const FIT_SHORTCUT = "Shift+1";
const FIT_PADDING = 0.15;
const FIT_SELECTION_PADDING = 0.3;
const ZOOM_STEP_DURATION_MS = 120;
const ZOOM_FIT_DURATION_MS = 200;

/**
 * Zoom pill, bottom-left: −, a percentage button opening fit/preset choices, +,
 * then a one-click fit. Kept apart from the editing toolbar the way dbdiagram
 * separates them — viewport control is a different gesture from editing, and
 * pinning it to a corner means it doesn't move as the toolbar grows.
 */
export function CanvasZoomBar({ selectedIds }: { selectedIds: string[] }) {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);

  const fitAll = () => fitView({ padding: FIT_PADDING, duration: ZOOM_FIT_DURATION_MS });

  return (
    <div className={CANVAS_TOOLBAR_CLASS}>
      <button
        type="button"
        className={CANVAS_TOOLBAR_ICON_BTN_CLASS}
        onClick={() => zoomOut({ duration: ZOOM_STEP_DURATION_MS })}
        data-tooltip={t("canvas.zoom.out")}
        data-tooltip-pos="top"
        aria-label={t("canvas.zoom.out")}
      >
        <span className="text-[17px] leading-none">−</span>
      </button>
      <ToolbarMenu
        tooltip={t("canvas.zoom.label")}
        minWidth={190}
        triggerClassName={(open) =>
          `${CANVAS_TOOLBAR_SEGMENT_CLASS} min-w-[58px] justify-center tabular-nums ${open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`
        }
        triggerContent={`${Math.round(zoom * 100)}%`}
      >
        {(close) => (
          <>
            <button
              type="button"
              className={`${CONTEXT_MENU_ITEM_CLASS} justify-between`}
              onClick={() => {
                fitAll();
                close();
              }}
            >
              {t("canvas.zoom.toFit")} <span className="text-text-muted">{FIT_SHORTCUT}</span>
            </button>
            <button
              type="button"
              className={`${CONTEXT_MENU_ITEM_CLASS} justify-between disabled:opacity-40`}
              disabled={selectedIds.length === 0}
              onClick={() => {
                fitView({
                  padding: FIT_SELECTION_PADDING,
                  duration: ZOOM_FIT_DURATION_MS,
                  nodes: selectedIds.map((id) => ({ id })),
                });
                close();
              }}
            >
              {t("canvas.zoom.toSelection")}
            </button>
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={CONTEXT_MENU_ITEM_CLASS}
                onClick={() => {
                  zoomTo(preset, { duration: ZOOM_FIT_DURATION_MS });
                  close();
                }}
              >
                {preset * 100}%
              </button>
            ))}
          </>
        )}
      </ToolbarMenu>
      <button
        type="button"
        className={CANVAS_TOOLBAR_ICON_BTN_CLASS}
        onClick={() => zoomIn({ duration: ZOOM_STEP_DURATION_MS })}
        data-tooltip={t("canvas.zoom.in")}
        data-tooltip-pos="top"
        aria-label={t("canvas.zoom.in")}
      >
        <span className="text-[17px] leading-none">+</span>
      </button>

      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <button
        type="button"
        className={CANVAS_TOOLBAR_ICON_BTN_CLASS}
        onClick={fitAll}
        data-tooltip={t("canvas.zoom.toFit")}
        data-tooltip-pos="top"
        aria-label={t("canvas.zoom.toFit")}
      >
        <LayoutGridIcon size={16} />
      </button>
    </div>
  );
}
