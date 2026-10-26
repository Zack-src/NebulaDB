<script lang="ts">
  import type { Session } from "@/types";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { fetchMyConnections } from "@/services/personalConnectionsApi";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import NavLinkButton from "@/components/ui/NavLinkButton.svelte";
  import { DatabaseIcon, SettingsIcon } from "@/components/icons/Icons";
  import PersonalAccountButton from "@/features/connections/personal/PersonalAccountButton.svelte";
  import DbConsole from "@/features/connections/console/DbConsole.svelte";
  let {
    session,
    onOpenAdmin,
    onOpenSettings,
  }: {
    session: Session;
    /** Takes an instance administrator to Admin → Connections. */
    onOpenAdmin?: () => void;
    /** Takes the person to their own database access in Settings. */
    onOpenSettings?: () => void;
  } = $props();
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
    <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <span>{t(session.isAdmin ? "databaseWorkspace.adminHint" : "databaseWorkspace.memberHint")}</span>
      {#if session.isAdmin}
        <NavLinkButton
          label={t("databaseWorkspace.openAdmin")}
          icon={DatabaseIcon}
          onNavigate={onOpenAdmin}
          variant="ghost"
          size="xs"
        />
      {:else}
        <NavLinkButton
          label={t("databaseWorkspace.openSettings")}
          icon={SettingsIcon}
          onNavigate={onOpenSettings}
          variant="ghost"
          size="xs"
        />
      {/if}
    </div>
  </section>
</div>
