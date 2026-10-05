<script lang="ts">
  import type { Session } from "@/types";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { fetchMyConnections } from "@/services/personalConnectionsApi";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import PersonalAccountButton from "@/features/connections/PersonalAccountButton.svelte";
  import DbConsole from "@/features/admin/connections/DbConsole.svelte";
  let { session }: { session: Session } = $props();
  const { t } = useTranslation();
  const connections = useAsyncResource(fetchMyConnections);
  let credentialRevision = $state(0);
  let selectedId = $state<string | null>(null);
  const rows = $derived([...(connections.data?.shared ?? []), ...(connections.data?.personal ?? [])]);
  const selected = $derived(rows.find((c) => c.id === selectedId));
</script>

<div class="grid min-w-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
  <nav class="space-y-2" aria-label={t("shell.bases")}>
    {#if connections.error}<ErrorText>{connections.error}</ErrorText>{/if}
    {#each rows as connection (connection.id)}
      <div class="rounded-lg border border-border bg-surface p-2">
        <button
          class="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover"
          aria-current={selectedId === connection.id ? "page" : undefined}
          onclick={() => (selectedId = connection.id)}
        >
          <strong class="block truncate">{connection.name}</strong><span class="text-xs text-text-muted"
            >{connection.engine} · {connection.database ?? connection.host ?? ""}</span
          >
        </button>
        <PersonalAccountButton {connection} onChanged={() => (credentialRevision += 1)} />
      </div>
    {/each}
    {#if !connections.loading && rows.length === 0}<EmptyState>{t("databaseWorkspace.empty")}</EmptyState>{/if}
  </nav>
  <section class="min-w-0 rounded-lg border border-border bg-surface-raised p-4">
    {#if selected}
      {#key `${selected.id}:${credentialRevision}`}<DbConsole connection={selected} mode="data" />{/key}
    {:else}<EmptyState>{t("databaseWorkspace.select")}</EmptyState>{/if}
    <p class="mt-4 text-xs text-text-muted">
      {t(session.isAdmin ? "databaseWorkspace.adminHint" : "databaseWorkspace.memberHint")}
    </p>
  </section>
</div>
