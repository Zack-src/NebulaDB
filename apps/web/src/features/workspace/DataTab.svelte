<script lang="ts">
  import type { DatabaseConnectionSummary, DbAccessLevel } from "@athanordb/shared";
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
   * The same component as Admin → Connexions → Ouvrir, with the same rules:
   * this changes where the console is reached from, not what it may do. An
   * instance administrator gets the whole console (on the admin listing's
   * shape, which backups need). A member gets it only on a connection an
   * instance administrator granted them — never because they are in the
   * project — and then only the explorer and SQL; the server checks the grant
   * on every request, the UI only follows it.
   */
  let {
    connectionId,
    connections,
    isAdmin,
    access,
  }: {
    connectionId: string | null;
    /** The project's own listing of its connections. */
    connections: readonly DatabaseConnectionSummary[];
    isAdmin: boolean;
    /** What this member was granted, per connection id. */
    access: ReadonlyMap<string, DbAccessLevel>;
  } = $props();

  const { t } = useTranslation();
  const adminConnections = useAsyncResource(() => (isAdmin ? listAdminConnections() : Promise.resolve(null)));
  const connection = $derived(
    isAdmin
      ? (adminConnections.data?.find((candidate) => candidate.id === connectionId) ?? null)
      : connectionId && access.has(connectionId)
        ? (connections.find((candidate) => candidate.id === connectionId) ?? null)
        : null,
  );
</script>

<div class="min-h-0 flex-1 overflow-y-auto bg-bg px-6 py-5">
  {#if adminConnections.error}
    <ErrorText>{adminConnections.error}</ErrorText>
  {:else if !connection}
    <EmptyState>
      {adminConnections.loading
        ? t("common.loading")
        : !isAdmin && connectionId
          ? t("dbAccess.noAccessHere")
          : t("workspace.data.noConnection")}
    </EmptyState>
  {:else}
    <!-- Keyed: every panel of the console is bound to one connection for its lifetime. -->
    {#key connection.id}
      <DbConsole {connection} />
    {/key}
  {/if}
</div>
