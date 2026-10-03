<script lang="ts">
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import DbConsole from "@/features/admin/connections/DbConsole.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { listAdminConnections } from "@/services/dbAdminApi";

  /**
   * The database console, as a tab of the project it serves: explorer, SQL,
   * and — where the engine has them — accounts and sessions, on the
   * workspace's current connection.
   *
   * The same component as Admin → Connexions → Ouvrir, with the same rules
   * (instance administrators only, everything audited, the structure policy):
   * this changes where the console is reached from, not what it may do. The
   * admin listing is what provides the connection in the shape the console
   * expects; a member never gets here, the tab is not offered to them.
   */
  let { connectionId }: { connectionId: string | null } = $props();

  const { t } = useTranslation();
  const connections = useAsyncResource(listAdminConnections);
  const connection = $derived(connections.data?.find((candidate) => candidate.id === connectionId) ?? null);
</script>

<div class="min-h-0 flex-1 overflow-y-auto bg-bg px-6 py-5">
  {#if connections.error}
    <ErrorText>{connections.error}</ErrorText>
  {:else if !connection}
    <EmptyState>{connections.loading ? t("common.loading") : t("workspace.data.noConnection")}</EmptyState>
  {:else}
    <!-- Keyed: every panel of the console is bound to one connection for its lifetime. -->
    {#key connection.id}
      <DbConsole {connection} />
    {/key}
  {/if}
</div>
