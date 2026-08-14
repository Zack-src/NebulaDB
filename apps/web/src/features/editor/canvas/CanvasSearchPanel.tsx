import { Panel } from "@xyflow/react";
import { ChevronLeftIcon, CloseIcon, SearchIcon } from "@/components/icons/Icons";
import { useTranslation } from "@/i18n/useTranslation";

export interface CanvasSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  activeIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/** 22px targets rather than the 2px of padding these used to be — stepping through matches is a repeated action. */
const STEP_BUTTON_CLASS =
  "flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-muted " +
  "transition-colors duration-100 enabled:hover:bg-surface-hover enabled:hover:text-text disabled:opacity-30 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary";

/** Ctrl/Cmd+F floating search box — find a table by name and jump the viewport to it. */
export function CanvasSearchPanel({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onNext,
  onPrevious,
  onClose,
}: CanvasSearchPanelProps) {
  const { t } = useTranslation();
  const hasQuery = query.trim() !== "";

  return (
    <Panel position="top-right" className="nodrag nopan !right-3 !top-3">
      <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-raised py-1 pl-2.5 pr-1 shadow-lg">
        <SearchIcon size={13} className="shrink-0 text-text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) onPrevious();
              else onNext();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder={t("canvas.search.placeholder")}
          aria-label={t("canvas.search.placeholder")}
          className="h-6 w-44 border-none bg-transparent px-1 text-[12.5px] text-text placeholder:text-text-muted focus:outline-hidden"
        />
        {hasQuery && (
          <span className="shrink-0 whitespace-nowrap px-0.5 text-[11px] tabular-nums text-text-muted">
            {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : "0/0"}
          </span>
        )}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={onPrevious}
          disabled={matchCount === 0}
          data-tooltip={t("canvas.search.previous")}
          aria-label={t("canvas.search.previous")}
        >
          <ChevronLeftIcon size={13} className="rotate-90" />
        </button>
        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={onNext}
          disabled={matchCount === 0}
          data-tooltip={t("canvas.search.next")}
          aria-label={t("canvas.search.next")}
        >
          <ChevronLeftIcon size={13} className="-rotate-90" />
        </button>
        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={onClose}
          data-tooltip={t("canvas.search.close")}
          aria-label={t("canvas.search.close")}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </Panel>
  );
}
