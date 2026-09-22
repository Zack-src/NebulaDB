<script lang="ts">
  import type { DatabaseEngine, DeploymentHistoryEntry } from "@athanordb/shared";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckCircleIcon, ClockIcon, CloseIcon } from "@/components/icons/Icons";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { listDeploymentHistory } from "@/services/connectionsApi";
  import RollbackConfirmModal from "./RollbackConfirmModal.svelte";

  /**
   * Past deployments (and rollbacks of them) for one connection, with a rollback
   * action on any entry that still has one available. Split out of
   * `DeploymentModal.svelte` rather than added inline — that file is already a
   * four-step wizard; this is a fifth, self-contained step with its own
   * fetch/confirm/execute state, not more branches threaded through the
   * existing ones.
   */
  let { projectId, connId, engine }: { projectId: string; connId: string; engine?: DatabaseEngine } = $props();

  const { t } = useTranslation();
  const history = useAsyncResource(() => listDeploymentHistory(projectId, connId));
  let confirmEntry = $state.raw<DeploymentHistoryEntry | null>(null);

  const entries = $derived(history.data ?? []);
</script>

<div class="space-y-3">
  {#if history.loading}
    <div class="flex h-48 items-center justify-center text-xs text-text-muted">{t("common.loading")}</div>
  {:else if history.error}
    <ErrorText>{history.error}</ErrorText>
  {:else if entries.length === 0}
    <div class="rounded-sm border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
      <Icon icon={ClockIcon} size={24} class="mx-auto mb-2 text-text-muted" />
      {t("deployment.historyEmpty")}
    </div>
  {:else}
    <ul class="max-h-96 space-y-2 overflow-y-auto pr-1">
      {#each entries as entry (entry.id)}
        <li class="rounded-sm border border-border bg-surface p-3 text-xs">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              {#if entry.success}
                <Icon icon={CheckCircleIcon} size={14} class="text-emerald-400" />
              {:else}
                <Icon icon={CloseIcon} size={14} class="text-rose-400" />
              {/if}
              <span class="font-semibold text-text">
                {entry.rollbackOf ? t("deployment.historyRollbackOfBadge") : t("deployment.historyDeployed")}
              </span>
              {#if entry.environment}<Badge tone="muted">{entry.environment}</Badge>{/if}
              {#if entry.rolledBack}<Badge tone="warning">{t("deployment.rolledBackBadge")}</Badge>{/if}
            </div>
            <span class="text-[11px] text-text-muted">{formatRelativeTime(entry.createdAt, i18n.locale)}</span>
          </div>

          <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
            <span>
              {t("deployment.historyStatements", { executed: entry.executedStatements, total: entry.totalStatements })}
              {entry.executedByEmail ? ` · ${t("deployment.historyBy", { email: entry.executedByEmail })}` : ""}
            </span>
            {#if entry.success && entry.rollbackSql && !entry.rolledBack}
              <Button size="xs" variant="outline" onclick={() => (confirmEntry = entry)}>
                {t("deployment.rollbackButton")}
              </Button>
            {/if}
          </div>

          {#if entry.error}<ErrorText>{entry.error}</ErrorText>{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if confirmEntry}
    <RollbackConfirmModal
      {projectId}
      {connId}
      entry={confirmEntry}
      {engine}
      onClose={() => (confirmEntry = null)}
      onRolledBack={() => {
        confirmEntry = null;
        history.reload();
      }}
    />
  {/if}
</div>
