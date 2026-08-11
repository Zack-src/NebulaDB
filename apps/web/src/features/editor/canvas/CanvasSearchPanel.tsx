import { Panel } from "@xyflow/react";
import { CloseIcon, SearchIcon } from "@/components/icons/Icons";
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

const STEP_BUTTON_CLASS =
  "shrink-0 rounded p-0.5 text-text-muted enabled:hover:bg-surface-hover enabled:hover:text-text disabled:opacity-30";

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

  return (
    <Panel position="top-right" className="nodrag nopan">
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 py-1.5 shadow-lg">
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
          className="w-40 border-none bg-transparent text-xs text-text placeholder:text-text-muted focus:outline-none"
        />
        {query.trim() !== "" && (
          <span className="shrink-0 whitespace-nowrap text-[11px] text-text-muted">
            {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : "0/0"}
          </span>
        )}
        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={onPrevious}
          disabled={matchCount === 0}
          data-tooltip={t("canvas.search.previous")}
        >
          ▲
        </button>
        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={onNext}
          disabled={matchCount === 0}
          data-tooltip={t("canvas.search.next")}
        >
          ▼
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text"
          onClick={onClose}
          data-tooltip={t("canvas.search.close")}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </Panel>
  );
}
