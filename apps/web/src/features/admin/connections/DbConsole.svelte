<script lang="ts">
  import type { AdminConnectionSummary } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ArchiveIcon, ChevronLeftIcon, CodeIcon, TableIcon, UsersIcon, ClockIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Tabs, { type TabItem } from "@/components/ui/Tabs.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchConnectionOverview } from "@/services/dbAdminApi";
  import ExplorerPanel from "./ExplorerPanel.svelte";
  import SessionsPanel from "./SessionsPanel.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import SqlPanel from "@/features/sql/SqlPanel.svelte";
  import UsersPanel from "./UsersPanel.svelte";
  import BackupsPanel from "@/features/backups/BackupsPanel.svelte";

  type Section = "explorer" | "sql" | "users" | "sessions" | "backups";

  /**
   * Everything done *on* one connected server. The overview request doubles as
   * the reachability check and tells the console what this engine supports, so
   * a section that doesn't apply (accounts on SQLite) is simply not offered.
   */
  let {
    connection,
    onClose,
  }: {
    connection: AdminConnectionSummary;
    /** Absent when the console is a tab of a project's workspace: there is no list to go back to. */
    onClose?: () => void;
  } = $props();

  const { t } = useTranslation();
  const overview = useAsyncResource(() => fetchConnectionOverview(connection.id));
  let section = $state<Section>("explorer");
  let database = $state("");

  // The explorer and the SQL console share one "current database", seeded once the server has said what exists.
  $effect(() => {
    const data = overview.data;
    if (!data || data.databases.some((d) => d.name === database)) return;
    const preferred = data.databases.find((d) => d.name === data.defaultDatabase) ?? data.databases.find((d) => !d.system);
    database = (preferred ?? data.databases[0])?.name ?? "";
  });

  const tabs = $derived.by(() => {
    const list: TabItem<Section>[] = [
      { id: "explorer", label: t("dbadmin.tab.explorer"), icon: TableIcon },
      { id: "sql", label: t("dbadmin.tab.sql"), icon: CodeIcon },
    ];
    if (overview.data?.capabilities.users) list.push({ id: "users", label: t("dbadmin.tab.users"), icon: UsersIcon });
    if (overview.data?.capabilities.sessions) list.push({ id: "sessions", label: t("dbadmin.tab.sessions"), icon: ClockIcon });
    list.push({ id: "backups", label: t("dbadmin.tab.backups"), icon: ArchiveIcon });
    return list;
  });
</script>

<div>
  <div class="mb-3 flex flex-wrap items-center gap-2">
    {#if onClose}
      <Button variant="ghost" size="sm" onclick={onClose}>
        <Icon icon={ChevronLeftIcon} size={13} />
        {t("dbadmin.backToConnections")}
      </Button>
    {/if}
    <span class="text-[14px] font-semibold">{connection.name}</span>
    <Badge tone="admin">{t(`connections.engine.${connection.engine}`)}</Badge>
    {#if connection.environment}<EnvironmentBadge name={connection.environment} color={connection.environmentColor} production={connection.production} />{/if}
    {#if connection.readOnly}<Badge tone="warning">{t("dbadmin.readOnly")}</Badge>{/if}
    {#if overview.data && overview.data.structurePolicy.projects.length > 0}
      {@const policy = overview.data.structurePolicy}
      <span data-tooltip={t(`dbadmin.structure.policyHint.${policy.policy}`)}>
        <Badge tone={policy.policy === "schema-only" ? "muted" : "warning"}>
          {t(`dbadmin.structure.policy.${policy.policy}`)}
        </Badge>
      </span>
    {/if}
  </div>

  {#if overview.error}
    <ErrorText>{overview.error}</ErrorText>
    <Button class="mt-3" size="sm" onclick={() => overview.reload()}>{t("dbadmin.retry")}</Button>
  {:else if !overview.data}
    <EmptyState>{t("dbadmin.connecting")}</EmptyState>
  {:else}
    {@const data = overview.data}
    <Tabs variant="line" {tabs} activeTab={section} onChange={(id) => (section = id)} class="mb-4" />
    {#if section === "explorer"}
      <ExplorerPanel connectionId={connection.id} overview={data} bind:database onDatabaseDropped={() => overview.reload()} />
    {:else if section === "sql"}
      <SqlPanel connectionId={connection.id} overview={data} bind:database />
    {:else if section === "users"}
      <UsersPanel connectionId={connection.id} engine={connection.engine} overview={data} />
    {:else if section === "sessions"}
      <SessionsPanel connectionId={connection.id} overview={data} />
    {:else}
      <BackupsPanel {connection} />
    {/if}
  {/if}
</div>
