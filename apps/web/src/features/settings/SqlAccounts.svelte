<script lang="ts">
  import type { MySqlAccount } from "@athanordb/shared";
  import PersonalAccountDialog from "@/features/connections/PersonalAccountDialog.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchMySqlAccounts } from "@/services/connectionsApi";

  /**
   * "Mes comptes SQL": the user's database account on every connection that
   * asks each person for theirs, in one place. Renders nothing when there is
   * no such connection they can use.
   */
  const { t } = useTranslation();
  const accounts = useAsyncResource(fetchMySqlAccounts);
  let editing = $state.raw<MySqlAccount | null>(null);
  const rows = $derived(accounts.data ?? []);
</script>

{#if rows.length > 0 || accounts.error}
  <div class="pt-6 border-t border-border/60" data-testid="sql-accounts">
    <h3 class="text-sm font-bold text-text mb-1">{t("settings.sqlAccounts.title")}</h3>
    <p class="text-xs text-text-muted mb-4">{t("settings.sqlAccounts.description")}</p>

    {#if accounts.error}<ErrorText>{accounts.error}</ErrorText>{/if}

    <ul class="space-y-2 max-w-2xl">
      {#each rows as account (account.connectionId)}
        <li
          class="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-xs"
          data-testid="sql-account-row"
          data-account={account.username ?? ""}
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-text truncate">{account.connectionName}</span>
              <Badge tone="muted">{account.engine}</Badge>
            </div>
            <div class="text-text-muted mt-0.5">
              {#if account.username}
                {account.username}{account.updatedAt
                  ? ` — ${t("settings.sqlAccounts.since", { date: formatDateTime(account.updatedAt, i18n.locale) })}`
                  : ""}
              {:else}
                <span class="text-warning">{t("settings.sqlAccounts.missing")}</span>
              {/if}
            </div>
          </div>
          <Button size="sm" variant={account.username ? "ghost" : "outline"} onclick={() => (editing = account)}>
            {account.username ? t("settings.sqlAccounts.edit") : t("settings.sqlAccounts.add")}
          </Button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

{#if editing}
  <PersonalAccountDialog
    connectionId={editing.connectionId}
    connectionName={editing.connectionName}
    status={editing}
    onChanged={() => accounts.reload()}
    onClose={() => (editing = null)}
  />
{/if}
