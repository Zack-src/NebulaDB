<script lang="ts">
  import type { DatabaseConnectionSummary } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CodeIcon, DatabaseIcon, LockIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Select from "@/components/ui/Select.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import Tabs, { type TabItem } from "@/components/ui/Tabs.svelte";
  import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The workspace's second bar: which section of the project is showing, and
   * which of its databases the sections that talk to one are talking to.
   *
   * One selector for the whole workspace, on purpose: the data tab, the
   * deployments tab and the Deploy button all act on "the current
   * connection", and its environment is always in view — in red when it is
   * the production stage — rather than being a detail of whichever dialog is open.
   */
  let {
    tabs,
    tab,
    onTabChange,
    connections,
    connectionId,
    onConnectionChange,
    sqlOpen = false,
    onToggleSql,
    lockCount = 0,
    onShowLocks,
  }: {
    tabs: TabItem<WorkspaceTab>[];
    tab: WorkspaceTab;
    onTabChange: (tab: WorkspaceTab) => void;
    connections: DatabaseConnectionSummary[];
    connectionId: string | null;
    onConnectionChange: (id: string) => void;
    sqlOpen?: boolean;
    /** Present when the SQL drawer can be opened here: on the schema tab, for someone who may query the database. */
    onToggleSql?: () => void;
    /** How many tables are locked; the button that lists them only shows when some are. */
    lockCount?: number;
    onShowLocks?: () => void;
  } = $props();

  const { t } = useTranslation();
  /** A key name, not prose — never translated. */
  const SQL_SHORTCUT = "Ctrl+J";
  const current = $derived(connections.find((connection) => connection.id === connectionId));
  const options = $derived(
    connections.map((connection) => ({
      value: connection.id,
      label: connection.name,
      hint: [t(`connections.engine.${connection.engine}`), connection.environment].filter(Boolean).join(" · "),
      icon: DatabaseIcon,
    })),
  );
</script>

<div class="flex shrink-0 items-end justify-between gap-4 border-b border-border bg-surface px-4">
  <!-- `-mb-px`: the active tab's underline sits on the bar's own border instead of doubling it. -->
  <Tabs variant="line" {tabs} activeTab={tab} onChange={onTabChange} class="-mb-px !border-b-0 pt-2.5" />
  {#if connections.length > 0 || (lockCount > 0 && onShowLocks)}
    <div class="flex items-center gap-2 py-1.5">
      {#if lockCount > 0 && onShowLocks}
        <Button
          size="sm"
          variant="ghost"
          onclick={onShowLocks}
          data-tooltip={t("locks.list.title")}
          data-tooltip-pos="bottom"
          aria-label={t("locks.list.button", { count: lockCount })}
        >
          <Icon icon={LockIcon} size={13} />
          {lockCount}
        </Button>
      {/if}
      {#if onToggleSql}
        <Button
          size="sm"
          variant="ghost"
          active={sqlOpen}
          onclick={onToggleSql}
          data-tooltip={`${t("workspace.sql.toggle")} (${SQL_SHORTCUT})`}
          data-tooltip-pos="bottom"
        >
          <Icon icon={CodeIcon} size={13} />
          {t("workspace.sql.title")}
        </Button>
      {/if}
      {#if current?.environment}
        <EnvironmentBadge name={current.environment} color={current.environmentColor} production={current.production} />
      {/if}
      {#if connections.length > 0}
        <Select
          size="sm"
          class="w-56"
          aria-label={t("workspace.connection")}
          value={connectionId ?? undefined}
          {options}
          onChange={onConnectionChange}
        />
      {/if}
    </div>
  {/if}
</div>
