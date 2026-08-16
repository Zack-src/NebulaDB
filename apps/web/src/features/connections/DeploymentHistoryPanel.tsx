import { useState } from "react";
import type { DatabaseEngine, DeploymentHistoryEntry } from "@athanordb/shared";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/overlays/Modal";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, CloseIcon } from "@/components/icons/Icons";
import { TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatRelativeTime } from "@/i18n/formatters";
import { useTranslation } from "@/i18n/useTranslation";
import { listDeploymentHistory, rollbackDeployment } from "@/services/connectionsApi";

/**
 * Past deployments (and rollbacks of them) for one connection, with a rollback
 * action on any entry that still has one available. Split out of
 * `DeploymentModal.tsx` rather than added inline — that file is already a
 * four-step wizard flagged for its own complexity; this is a fifth,
 * self-contained step with its own fetch/confirm/execute state, not more
 * branches threaded through the existing ones.
 */
export function DeploymentHistoryPanel(props: { projectId: string; connId: string; engine?: DatabaseEngine }) {
  const { t, locale } = useTranslation();
  const history = useAsyncResource(() => listDeploymentHistory(props.projectId, props.connId), [props.connId]);
  const [confirmEntry, setConfirmEntry] = useState<DeploymentHistoryEntry | null>(null);

  const entries = history.data ?? [];

  return (
    <div className="space-y-3">
      {history.loading ? (
        <div className="flex h-48 items-center justify-center text-xs text-text-muted">{t("common.loading")}</div>
      ) : history.error ? (
        <ErrorText>{history.error}</ErrorText>
      ) : entries.length === 0 ? (
        <div className="rounded-sm border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
          <ClockIcon size={24} className="mx-auto mb-2 text-text-muted" />
          {t("deployment.historyEmpty")}
        </div>
      ) : (
        <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-sm border border-border bg-surface p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {entry.success ? (
                    <CheckCircleIcon size={14} className="text-emerald-400" />
                  ) : (
                    <CloseIcon size={14} className="text-rose-400" />
                  )}
                  <span className="font-semibold text-text">
                    {entry.rollbackOf ? t("deployment.historyRollbackOfBadge") : t("deployment.historyDeployed")}
                  </span>
                  {entry.environment && <Badge tone="muted">{entry.environment}</Badge>}
                  {entry.rolledBack && <Badge tone="warning">{t("deployment.rolledBackBadge")}</Badge>}
                </div>
                <span className="text-[11px] text-text-muted">{formatRelativeTime(entry.createdAt, locale)}</span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
                <span>
                  {t("deployment.historyStatements", {
                    executed: entry.executedStatements,
                    total: entry.totalStatements,
                  })}
                  {entry.executedByEmail ? ` · ${t("deployment.historyBy", { email: entry.executedByEmail })}` : ""}
                </span>
                {entry.success && entry.rollbackSql && !entry.rolledBack && (
                  <Button size="xs" variant="outline" onClick={() => setConfirmEntry(entry)}>
                    {t("deployment.rollbackButton")}
                  </Button>
                )}
              </div>

              {entry.error && <ErrorText>{entry.error}</ErrorText>}
            </li>
          ))}
        </ul>
      )}

      {confirmEntry && (
        <RollbackConfirmModal
          projectId={props.projectId}
          connId={props.connId}
          entry={confirmEntry}
          engine={props.engine}
          onClose={() => setConfirmEntry(null)}
          onRolledBack={() => {
            setConfirmEntry(null);
            history.reload();
          }}
        />
      )}
    </div>
  );
}

function RollbackConfirmModal(props: {
  projectId: string;
  connId: string;
  entry: DeploymentHistoryEntry;
  engine?: DatabaseEngine;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const { t } = useTranslation();
  const rollback = useAsyncAction(async () => {
    await rollbackDeployment(props.projectId, props.connId, props.entry.id);
    props.onRolledBack();
  });

  return (
    <Modal title={t("deployment.rollbackConfirmTitle")} onClose={props.onClose}>
      <div className="space-y-3">
        <Hint>{t("deployment.rollbackConfirmBody")}</Hint>

        {props.engine === "mysql" && (
          <div className="flex items-start gap-2 rounded-sm border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-300">
            <AlertTriangleIcon size={14} className="mt-px shrink-0" />
            <span>{t("deployment.rollbackWarningMysql")}</span>
          </div>
        )}

        <textarea readOnly className={`${TEXTAREA_CODE_CLASS} h-48 w-full`} value={props.entry.rollbackSql ?? ""} />

        {rollback.error && <ErrorText>{rollback.error}</ErrorText>}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={props.onClose} disabled={rollback.pending}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="danger" onClick={() => void rollback.run()} disabled={rollback.pending}>
            {rollback.pending ? t("deployment.rollingBack") : t("deployment.rollbackConfirmAction")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
