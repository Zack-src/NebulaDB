<script lang="ts">
  import type { DatabaseConnectionSummary } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, CodeIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import SqlPanel from "@/features/sql/SqlPanel.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchConnectionOverview } from "@/services/dbAdminApi";

  /**
   * The SQL console as a drawer under the schema: write a query while looking
   * at the diagram it is about, on the workspace's current connection.
   *
   * It is the console's own panel — same server routes, same read-only
   * default, same audit, same structure policy — in a smaller frame. Nothing
   * here widens who may run SQL: the drawer is only offered to those the
   * console is offered to.
   */
  let {
    connection,
    request,
    onClose,
  }: {
    connection: DatabaseConnectionSummary;
    /** A statement to load and run — see `SqlPanel`. */
    request: { sql: string; token: number } | null;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  /** A key name, not prose — never translated. */
  const TOGGLE_SHORTCUT = "Ctrl+J";
  const overview = useAsyncResource(() => fetchConnectionOverview(connection.id));
  let database = $state("");

  // Same seeding as the console: the connection's own database when the server has several.
  $effect(() => {
    const data = overview.data;
    if (!data || data.databases.some((candidate) => candidate.name === database)) return;
    const preferred =
      data.databases.find((candidate) => candidate.name === data.defaultDatabase) ??
      data.databases.find((candidate) => !candidate.system);
    database = (preferred ?? data.databases[0])?.name ?? "";
  });
</script>

<section class="flex min-h-0 flex-1 flex-col bg-surface" aria-label={t("workspace.sql.title")}>
  <header class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
    <Icon icon={CodeIcon} size={14} class="text-text-muted" />
    <span class="text-body-sm font-semibold text-text">{t("workspace.sql.title")}</span>
    <span class="truncate text-label text-text-muted">{connection.name}</span>
    {#if connection.environment}
      <EnvironmentBadge name={connection.environment} color={connection.environmentColor} production={connection.production} />
    {/if}
    <span class="flex-1"></span>
    <kbd class="font-sans text-caption text-text-muted">{TOGGLE_SHORTCUT}</kbd>
    <Button variant="ghost" size="icon-xs" onclick={onClose} data-tooltip={t("common.close")}>
      <Icon icon={CloseIcon} size={12} />
    </Button>
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
    {#if overview.error}
      <ErrorText>{overview.error}</ErrorText>
    {:else if !overview.data}
      <p class="m-0 text-label text-text-muted">{t("dbadmin.connecting")}</p>
    {:else}
      <SqlPanel connectionId={connection.id} overview={overview.data} bind:database {request} compact />
    {/if}
  </div>
</section>
