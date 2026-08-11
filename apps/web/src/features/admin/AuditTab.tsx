import { useState } from "react";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/List";
import { SELECT_SM_CLASS } from "@/components/ui/inputStyles";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatDateTime } from "@/i18n/formatters";
import { useTranslation } from "@/i18n/useTranslation";
import { fetchAuditLog } from "@/services/auditApi";
import type { TranslationKeyOf } from "@/types";

/**
 * Read-only view of the audit trail. There is intentionally no way to edit or
 * delete entries from here — a console that let an administrator rewrite the
 * record of what administrators did would be worse than having no record.
 */
const ACTION_FILTERS: { value: string; labelKey: TranslationKeyOf }[] = [
  { value: "", labelKey: "admin.audit.filter.all" },
  { value: "project.delete", labelKey: "admin.audit.filter.projectDelete" },
  { value: "project.export", labelKey: "admin.audit.filter.projectExport" },
  { value: "project.team.grant", labelKey: "admin.audit.filter.permissionGranted" },
  { value: "project.team.revoke", labelKey: "admin.audit.filter.permissionRevoked" },
  { value: "user.disable", labelKey: "admin.audit.filter.userDisabled" },
  { value: "user.delete", labelKey: "admin.audit.filter.userDeleted" },
  { value: "user.password.reset", labelKey: "admin.audit.filter.passwordReset" },
  { value: "auth.login.locked", labelKey: "admin.audit.filter.loginLocked" },
];

/** Actions worth spotting at a glance in a long list. */
const SEVERE_ACTIONS = new Set(["project.delete", "user.delete", "user.disable", "auth.login.locked"]);

const EMPTY_CELL = "—";

export function AuditTab() {
  const { t, locale } = useTranslation();
  const [action, setAction] = useState("");
  const entries = useAsyncResource(() => fetchAuditLog(action ? { action } : {}), [action]);

  const rows = entries.data ?? [];

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <select className={SELECT_SM_CLASS} value={action} onChange={(event) => setAction(event.target.value)}>
          {ACTION_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {t(filter.labelKey)}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">
          {entries.loading ? t("common.loading") : t("admin.audit.entryCount", { count: rows.length })}
        </span>
      </div>

      {entries.error && <ErrorText>{entries.error}</ErrorText>}

      {!entries.loading && rows.length === 0 ? (
        <EmptyState>{t("admin.audit.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="bg-surface-raised/60 text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">{t("admin.audit.column.date")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.audit.column.actor")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.audit.column.action")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.audit.column.target")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.audit.column.detail")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.audit.column.ip")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-t border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                    {formatDateTime(entry.createdAt, locale)}
                  </td>
                  <td className="px-3 py-2">
                    {entry.actorEmail ?? <span className="text-text-muted">{EMPTY_CELL}</span>}
                  </td>
                  <td
                    className={`px-3 py-2 font-mono text-[11.5px] ${SEVERE_ACTIONS.has(entry.action) ? "text-danger" : ""}`}
                  >
                    {entry.action}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-text-muted">
                    {entry.targetType ? `${entry.targetType}/${entry.targetId?.slice(0, 8)}` : EMPTY_CELL}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{entry.detail ?? EMPTY_CELL}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{entry.ip ?? EMPTY_CELL}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Hint>{t("admin.audit.scopeNote")}</Hint>
    </div>
  );
}
