import type { DetailLevel } from "@athanordb/shared";
import { ChevronRightIcon } from "@/components/icons/Icons";
import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
import { CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS, CANVAS_TOOLBAR_SEGMENT_CLASS } from "@/components/ui/canvasToolbarStyles";
import { useTranslation } from "@/i18n/useTranslation";
import type { TranslationKeyOf } from "@/types";
import { ToolbarMenu } from "./ToolbarMenu";

const DETAIL_LEVELS = ["compact", "standard", "full"] as const;

const LABEL_KEY = {
  compact: "canvas.detail.compact",
  standard: "canvas.detail.standard",
  full: "canvas.detail.full",
} as const satisfies Record<DetailLevel, TranslationKeyOf>;

const HINT_KEY = {
  compact: "canvas.detail.compactHint",
  standard: "canvas.detail.standardHint",
  full: "canvas.detail.fullHint",
} as const satisfies Record<DetailLevel, TranslationKeyOf>;

export interface DetailLevelDropdownProps {
  value: DetailLevel | null;
  onChange: (level: DetailLevel) => void;
}

/**
 * Detail-level control — a single button opening a popover list instead of
 * three always-visible segments, so the floating toolbar stays compact.
 */
export function DetailLevelDropdown({ value, onChange }: DetailLevelDropdownProps) {
  const { t } = useTranslation();

  return (
    <ToolbarMenu
      tooltip={t("canvas.detail.tooltip")}
      triggerClassName={(open) => `${CANVAS_TOOLBAR_SEGMENT_CLASS} ${open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
      triggerContent={
        <>
          {value ? t(LABEL_KEY[value]) : t("canvas.detail.label")}
          <ChevronRightIcon size={12} className="-rotate-90" />
        </>
      }
    >
      {(close) =>
        DETAIL_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`${CONTEXT_MENU_ITEM_CLASS} justify-between ${level === value ? "text-text" : ""}`}
            onClick={() => {
              onChange(level);
              close();
            }}
            data-tooltip={t(HINT_KEY[level])}
          >
            {t(LABEL_KEY[level])}
            {level === value && <span className="text-primary">✓</span>}
          </button>
        ))
      }
    </ToolbarMenu>
  );
}
