import { Fragment, useState } from "react";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/List";
import { Badge } from "@/components/ui/Badge";
import { SELECT_SM_CLASS } from "@/components/ui/inputStyles";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatDateTime } from "@/i18n/formatters";
import { useTranslation } from "@/i18n/useTranslation";
import { fetchErrorLog } from "@/services/errorsApi";
import type { TranslationKeyOf } from "@/types";

const SOURCE_FILTERS: { value: "" | "server" | "client"; labelKey: TranslationKeyOf }[] = [
  { value: "", labelKey: "admin.errors.filter.all" },
  { value: "server", labelKey: "admin.errors.filter.server" },
  { value: "client", labelKey: "admin.errors.filter.client" },
];

const EMPTY_CELL = "—";

/**
 * Read-only, same shape as `AuditTab` — the two are siblings on purpose:
 * where the audit log answers "what did someone do", this answers "what
 * broke", server-side unhandled throws and client-side render crashes both.
 * See `errorLog.ts` on the server for why this exists and what it doesn't
 * try to be (not tamper-evident, not a compliance trail — a debugging aid).
 */
export function ErrorsTab() {
  const { t, locale } = useTranslation();
  const [source, setSource] = useState<"" | "server" | "client">("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const entries = useAsyncResource(() => fetchErrorLog(source ? { source } : {}), [source]);

  const rows = entries.data ?? [];

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <select
          className={SELECT_SM_CLASS}
          value={source}
          onChange={(event) => setSource(event.target.value as "" | "server" | "client")}
        >
          {SOURCE_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {t(filter.labelKey)}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">
          {entries.loading ? t("common.loading") : t("admin.errors.entryCount", { count: rows.length })}
        </span>
      </div>

      {entries.error && <ErrorText>{entries.error}</ErrorText>}

      {!entries.loading && rows.length === 0 ? (
        <EmptyState>{t("admin.errors.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="bg-surface-raised/60 text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">{t("admin.errors.column.date")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.errors.column.source")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.errors.column.message")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.errors.column.user")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.errors.column.context")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <Fragment key={entry.id}>
                  <tr
                    className="cursor-pointer border-t border-border/60 hover:bg-surface-hover/60"
                    onClick={() => setExpandedId((current) => (current === entry.id ? null : entry.id))}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                      {formatDateTime(entry.createdAt, locale)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={entry.source === "server" ? "danger" : "warning"}>{entry.source}</Badge>
                    </td>
                    <td className="max-w-[320px] truncate px-3 py-2 font-mono text-[11.5px]">{entry.message}</td>
                    <td className="px-3 py-2 text-text-secondary">{entry.userEmail ?? EMPTY_CELL}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 font-mono text-[11px] text-text-muted">
                      {entry.context ?? EMPTY_CELL}
                    </td>
                  </tr>
                  {expandedId === entry.id && entry.stack && (
                    <tr className="border-t border-border/60 bg-surface-raised/40">
                      <td colSpan={5} className="px-3 py-2">
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-muted">
                          {entry.stack}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Hint>{t("admin.errors.scopeNote")}</Hint>
    </div>
  );
}
