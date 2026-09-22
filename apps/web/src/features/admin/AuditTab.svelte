<script lang="ts" module>
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
    { value: "connection.deploy", labelKey: "admin.audit.filter.connectionDeploy" },
  ];

  /** Actions worth spotting at a glance in a long list. */
  const SEVERE_ACTIONS = new Set(["project.delete", "user.delete", "user.disable", "auth.login.locked", "connection.deploy"]);

  const EMPTY_CELL = "—";
</script>

<script lang="ts">
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { SELECT_SM_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchAuditLog } from "@/services/auditApi";

  const { t } = useTranslation();
  let action = $state("");
  const entries = useAsyncResource(() => fetchAuditLog(action ? { action } : {}));

  const rows = $derived(entries.data ?? []);
</script>

<div>
  <div class="mb-3 flex items-center gap-3">
    <select class={SELECT_SM_CLASS} bind:value={action}>
      {#each ACTION_FILTERS as filter (filter.value)}
        <option value={filter.value}>{t(filter.labelKey)}</option>
      {/each}
    </select>
    <span class="text-xs text-text-muted">
      {entries.loading ? t("common.loading") : t("admin.audit.entryCount", { count: rows.length })}
    </span>
  </div>

  {#if entries.error}<ErrorText>{entries.error}</ErrorText>{/if}

  {#if !entries.loading && rows.length === 0}
    <EmptyState>{t("admin.audit.empty")}</EmptyState>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full min-w-[720px] text-left text-[12.5px]">
        <thead class="bg-surface-raised/60 text-[11px] uppercase tracking-wide text-text-muted">
          <tr>
            <th class="px-3 py-2 font-semibold">{t("admin.audit.column.date")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.audit.column.actor")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.audit.column.action")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.audit.column.target")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.audit.column.detail")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.audit.column.ip")}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as entry (entry.id)}
            <tr class="border-t border-border/60">
              <td class="whitespace-nowrap px-3 py-2 text-text-muted">{formatDateTime(entry.createdAt, i18n.locale)}</td>
              <td class="px-3 py-2">
                {#if entry.actorEmail}{entry.actorEmail}{:else}<span class="text-text-muted">{EMPTY_CELL}</span>{/if}
              </td>
              <td class={`px-3 py-2 font-mono text-[11.5px] ${SEVERE_ACTIONS.has(entry.action) ? "text-danger" : ""}`}>
                {entry.action}
              </td>
              <td class="px-3 py-2 font-mono text-[11px] text-text-muted">
                {entry.targetType ? `${entry.targetType}/${entry.targetId?.slice(0, 8)}` : EMPTY_CELL}
              </td>
              <td class="px-3 py-2 text-text-secondary">{entry.detail ?? EMPTY_CELL}</td>
              <td class="px-3 py-2 font-mono text-[11px] text-text-muted">{entry.ip ?? EMPTY_CELL}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <Hint>{t("admin.audit.scopeNote")}</Hint>
</div>
