import { useTranslation } from "@/i18n/useTranslation";
import type { CursorInfo } from "./types";

/** Bottom strip of the editor: cursor position, diagnostics count, wrap toggle, font-size controls. */
export function StatusBar(props: {
  cursor: CursorInfo;
  wrap: boolean;
  onToggleWrap: () => void;
  fontSize: number;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onShowProblems: () => void;
}) {
  const { cursor, wrap, onToggleWrap, fontSize, onIncreaseFont, onDecreaseFont, onShowProblems } = props;
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-2.5 py-1 text-[11px] text-text-muted">
      <span title={t("dbml.lineColumn")}>
        Ln {cursor.line}, Col {cursor.column}
      </span>
      {cursor.selected > 0 && <span>{t("dbml.selectedChars", { count: cursor.selected })}</span>}
      {cursor.cursors > 1 && <span className="text-primary">{t("dbml.cursorCount", { count: cursor.cursors })}</span>}
      {cursor.breadcrumb && (
        <span className="truncate" title={t("dbml.currentTable")}>
          › {cursor.breadcrumb}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {(cursor.errors > 0 || cursor.warnings > 0) && (
          <button type="button" onClick={onShowProblems} className="rounded px-1 hover:bg-surface-hover" title={t("dbml.showProblems")}>
            <span className={cursor.errors ? "text-danger" : ""}>✕ {cursor.errors}</span>{" "}
            <span className={cursor.warnings ? "text-warning" : ""}>⚠ {cursor.warnings}</span>
          </button>
        )}
        <button type="button" onClick={onToggleWrap} className="rounded px-1 hover:bg-surface-hover" title={t("dbml.toggleWrap")}>
          {t(wrap ? "dbml.wrapOn" : "dbml.wrapOff")}
        </button>
        <button type="button" onClick={onDecreaseFont} className="rounded px-1 hover:bg-surface-hover" title={t("dbml.fontDecrease")}>
          A−
        </button>
        <span>{fontSize}px</span>
        <button type="button" onClick={onIncreaseFont} className="rounded px-1 hover:bg-surface-hover" title={t("dbml.fontIncrease")}>
          A+
        </button>
        <span title={t("dbml.indentation")}>{t("dbml.twoSpaces")}</span>
      </span>
    </div>
  );
}
