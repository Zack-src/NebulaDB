import type { McdWarning } from "@athanordb/shared";
import { useTranslation } from "@/i18n/useTranslation";
import type { TranslationKeyOf } from "@/types";

const REASON_KEY: Record<McdWarning["reason"], TranslationKeyOf> = {
  "possible-ternary-association": "mcd.warning.ternary",
  "ambiguous-junction-table": "mcd.warning.ambiguousJunction",
};

/**
 * Lists the tables `deriveMCD` couldn't cleanly fold into an association —
 * shown up front rather than silently, so a schema with a real ternary
 * relationship (or a junction table that got an extra column added
 * inconsistently) doesn't quietly read as "fully modeled" when it isn't.
 */
export function McdWarningsBanner({ warnings }: { warnings: McdWarning[] }) {
  const { t } = useTranslation();

  return (
    <div className="absolute left-1/2 top-3 z-10 max-w-[520px] -translate-x-1/2 rounded-sm border border-warning bg-surface px-3 py-2 text-[12px] text-text shadow-md">
      <div className="mb-1 font-semibold text-warning">{t("mcd.warning.title")}</div>
      <ul className="flex flex-col gap-0.5">
        {warnings.map((w) => (
          <li key={w.tableId} className="text-text-secondary">
            <span className="font-mono text-text">{w.tableName}</span> — {t(REASON_KEY[w.reason])}
          </li>
        ))}
      </ul>
    </div>
  );
}
