<script lang="ts">
  import type { AdminConnectionSummary } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon, CodeIcon, TableIcon, UsersIcon, ClockIcon } from "@/components/icons/Icons";
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
  import SqlPanel from "./SqlPanel.svelte";
  import UsersPanel from "./UsersPanel.svelte";

  type Section = "explorer" | "sql" | "users" | "sessions";

  /**
   * Everything done *on* one connected server. The overview request doubles as
   * the reachability check and tells the console what this engine supports, so
   * a section that doesn't apply (accounts on SQLite) is simply not offered.
   */
  let { connection, onClose }: { connection: AdminConnectionSummary; onClose: () => void } = $props();

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
    return list;
  });
</script>

<div>
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="sm" onclick={onClose}>
      <Icon icon={ChevronLeftIcon} size={13} />
      {t("dbadmin.backToConnections")}
    </Button>
    <span class="text-[14px] font-semibold">{connection.name}</span>
    <Badge tone="admin">{t(`connections.engine.${connection.engine}`)}</Badge>
    {#if connection.environment}<span class="text-xs text-text-muted">{connection.environment}</span>{/if}
    {#if connection.readOnly}<Badge tone="warning">{t("dbadmin.readOnly")}</Badge>{/if}
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
    {:else}
      <SessionsPanel connectionId={connection.id} overview={data} />
    {/if}
  {/if}
</div>
