<script lang="ts">
  import type { DatabaseConnectionSummary } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CodeIcon, DatabaseIcon, LockIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Select from "@/components/ui/Select.svelte";
  import PersonalAccountButton from "@/features/connections/personal/PersonalAccountButton.svelte";
  import EnvironmentBadge, { STAGE_COLOR } from "@/features/environments/EnvironmentBadge.svelte";
  import Tabs, { type TabItem } from "@/components/ui/Tabs.svelte";
  import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The workspace's second bar: which section of the project is showing, and
   * which of its databases the sections that talk to one are talking to.
   *
   * One selector for the project: its SQL drawer and deployment panel both
   * use this connection. Its environment remains visible on every tab.
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
  /** A handful of databases: one click each, coloured by stage, instead of a dropdown to open. */
  const quickSwitch = $derived(connections.length >= 2 && connections.length <= 4);
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
      {#if current?.environment && !quickSwitch}
        <EnvironmentBadge name={current.environment} color={current.environmentColor} production={current.production} />
      {/if}
      {#if current}
        <PersonalAccountButton connection={current} />
      {/if}
      {#if quickSwitch}
        <div class="flex items-center gap-1" role="group" aria-label={t("workspace.environmentSwitch")}>
          {#each connections as connection (connection.id)}
            {@const shade = connection.environment
              ? connection.production
                ? STAGE_COLOR.red
                : STAGE_COLOR[connection.environmentColor ?? "grey"]
              : "var(--color-text-muted)"}
            {@const active = connection.id === connectionId}
            <button
              type="button"
              class="flex max-w-[180px] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              style:color={active ? shade : "var(--color-text-muted)"}
              style:border-color={active ? `color-mix(in srgb, ${shade} 50%, transparent)` : "var(--color-border)"}
              style:background-color={active ? `color-mix(in srgb, ${shade} 14%, transparent)` : "transparent"}
              aria-pressed={active}
              data-tooltip={[connection.environment, t(`connections.engine.${connection.engine}`)]
                .filter(Boolean)
                .join(" · ")}
              onclick={() => onConnectionChange(connection.id)}
            >
              <span class="h-1.5 w-1.5 shrink-0 rounded-full" style:background-color={shade}></span>
              <span class="truncate">{connection.name}</span>
            </button>
          {/each}
        </div>
      {:else if connections.length > 0}
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
