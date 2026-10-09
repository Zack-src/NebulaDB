<script lang="ts">
  import { MONITOR_INTERVALS, type AccountChange, type DriftEvent } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { RestoreIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import Select from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime, formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    acceptAccountState,
    fetchMonitoring,
    runMonitoringCheck,
    saveMonitoring,
    setAccountWatch,
    type MonitoringState,
  } from "@/services/monitoringApi";

    /**
     * "Surveillance": whether the project's databases are read on a schedule and compared with the
     * state left by the last deployment or pull. An unexplained difference turns on the editor's
     * drift banner, is listed here and goes to the project's webhooks.
     *
     * The accounts watch is for instance administrators (the server sends `accounts: null`
     * otherwise): accounts, roles and privileges against a reference the console's own changes move.
     * Not offered when no linked database has accounts (SQLite).
     */
  let { projectId, canManage }: { projectId: string; canManage: boolean } = $props();

  const { t } = useTranslation();
  const monitoring = useAsyncResource(() => fetchMonitoring(projectId));
  let override = $state.raw<MonitoringState | null>(null);
  const current = $derived(override ?? monitoring.data);
  let ignoreDraft = $state<string | null>(null);

  const save = useAsyncAction(async (patch: { enabled?: boolean; intervalMinutes?: number; ignoreTables?: string[] }) => {
    if (!current) return;
    const settings = await saveMonitoring(projectId, {
      enabled: patch.enabled ?? current.settings.enabled,
      intervalMinutes: patch.intervalMinutes ?? current.settings.intervalMinutes,
      ignoreTables: patch.ignoreTables ?? current.settings.ignoreTables,
    });
    override = { ...current, settings };
  });
  const check = useAsyncAction(async () => {
    override = await runMonitoringCheck(projectId);
  });
  const watchAccounts = useAsyncAction(async (enabled: boolean) => {
    override = await setAccountWatch(projectId, enabled);
  });
  /** The database whose current accounts are about to become the reference. */
  let accepting = $state<{ connectionId: string; connectionName: string } | null>(null);
  const accept = useAsyncAction(async () => {
    if (!accepting) return;
    override = await acceptAccountState(projectId, accepting.connectionId);
    accepting = null;
  });

  function saveIgnore() {
    if (ignoreDraft === null) return;
    const ignoreTables = ignoreDraft
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    ignoreDraft = null;
    void save.run({ ignoreTables });
  }

  const intervalOptions = $derived(
    MONITOR_INTERVALS.map((minutes) => ({ value: minutes, label: t(`monitoring.every.${minutes}` as "monitoring.every.5") })),
  );
  const STATUS_TONE = { open: "danger", resolved: "success", ignored: "muted" } as const;
  const describeChange = (change: AccountChange) =>
    t(`monitoring.accountChange.${change.type}`, {
      principal: change.principal,
      role: change.role ?? "",
      privilege: change.privilege ?? "",
      object: [change.scope, change.object].filter(Boolean).join(" "),
    });
  const summary = (event: DriftEvent) =>
    event.kind === "unreachable"
      ? (event.error ?? "")
      : event.kind === "accounts"
        ? (event.accountChanges ?? []).map(describeChange).join(" · ")
        : [...event.added.map((n) => `+${n}`), ...event.changed.map((n) => `~${n}`), ...event.removed.map((n) => `−${n}`)].join(
          " ",
        );
  const busy = $derived(save.pending || check.pending || watchAccounts.pending);
  // Imposed from a connection (Admin → Connexions): on and paced there; the ignored tables are the instance administrators'.
  const forced = $derived(current?.settings.forced ?? null);
  const instanceAdmin = $derived(current?.accounts != null);
</script>

<section class="rounded-md border border-border bg-surface p-3 text-xs" aria-labelledby="monitoring-title" data-testid="monitoring">
  <div class="mb-2 flex flex-wrap items-center gap-2">
    <h3 id="monitoring-title" class="m-0 flex-1 text-body-sm font-semibold text-text">{t("monitoring.title")}</h3>
    {#if current}
      <span class="text-text-muted">
        {current.settings.lastCheckedAt
          ? t("monitoring.lastChecked", { when: formatRelativeTime(parseServerTime(current.settings.lastCheckedAt), i18n.locale) })
          : t("monitoring.neverChecked")}
      </span>
      {#if canManage}
        <Button size="xs" variant="outline" onclick={() => void check.run()} disabled={busy}>
          <Icon icon={RestoreIcon} size={12} />
          {check.pending ? t("common.loading") : t("monitoring.checkNow")}
        </Button>
      {/if}
    {/if}
  </div>
  <Hint>{t("monitoring.hint")}</Hint>

  {#if current}
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="flex items-center gap-2">
        <Switch
          size="sm"
          checked={current.settings.enabled}
          disabled={!canManage || busy || forced !== null}
          onChange={(enabled) => void save.run({ enabled })}
          aria-label={t("monitoring.enable")}
        />
        <span>{t("monitoring.enable")}</span>
      </span>
      <Select
        size="sm"
        class="w-44"
        aria-label={t("monitoring.interval")}
        value={current.settings.intervalMinutes}
        options={intervalOptions}
        disabled={!canManage || busy || forced !== null}
        onChange={(intervalMinutes) => void save.run({ intervalMinutes })}
      />
      <input
        class={`${INPUT_SM_CLASS} min-w-[200px] flex-1`}
        aria-label={t("monitoring.ignore")}
        placeholder={t("monitoring.ignorePlaceholder")}
        value={ignoreDraft ?? current.settings.ignoreTables.join(", ")}
        disabled={!canManage || busy || (forced !== null && !instanceAdmin)}
        oninput={(event) => (ignoreDraft = event.currentTarget.value)}
        onblur={saveIgnore}
        onkeydown={(event) => {
          if (event.key === "Enter") saveIgnore();
        }}
      />
    </div>
    {#if forced}
      <p class="m-0 mt-2 flex flex-wrap items-center gap-2 text-text-muted" data-testid="monitoring-forced">
        <Badge tone="admin">{t("monitoring.accounts.adminOnly")}</Badge>
        {t("monitoring.forced", {
          connections: forced.connections.join(", "),
          interval: t(`monitoring.every.${forced.intervalMinutes}` as "monitoring.every.5"),
        })}
      </p>
    {/if}

    {#if current.accounts && current.accounts.connections.length > 0}
      {@const accounts = current.accounts}
      <div class="mt-3 border-t border-border/60 pt-2" data-testid="monitoring-accounts">
        <span class="flex items-center gap-2">
          <Switch
            size="sm"
            checked={accounts.enabled}
            disabled={!accounts.canManage || busy}
            onChange={(enabled) => void watchAccounts.run(enabled)}
            aria-label={t("monitoring.accounts.enable")}
          />
          <span>{t("monitoring.accounts.enable")}</span>
          <Badge tone="admin">{t("monitoring.accounts.adminOnly")}</Badge>
        </span>
        <Hint>{t(current.settings.enabled ? "monitoring.accounts.hint" : "monitoring.accounts.needsWatch")}</Hint>
        {#if accounts.enabled}
          <ul class="m-0 mt-1 list-none space-y-1 p-0" aria-label={t("monitoring.accounts.databases")}>
            {#each accounts.connections as connection (connection.connectionId)}
              <li class="flex flex-wrap items-center gap-2" data-testid="monitoring-accounts-connection">
                <span class="font-semibold">{connection.connectionName}</span>
                {#if connection.lastError}
                  <Badge tone="warning">{t("monitoring.accounts.unreadable")}</Badge>
                  <span class="min-w-0 flex-1 truncate text-text-muted" title={connection.lastError}>{connection.lastError}</span>
                {:else if !connection.referenceAt}
                  <span class="text-text-muted">{t("monitoring.accounts.noReference")}</span>
                {:else}
                  <Badge tone={connection.differs ? "danger" : "success"}>
                    {t(connection.differs ? "monitoring.accounts.differs" : "monitoring.accounts.same")}
                  </Badge>
                  <span class="text-text-muted">
                    {t("monitoring.accounts.referenceAt", {
                      when: formatDateTime(parseServerTime(connection.referenceAt), i18n.locale),
                    })}
                  </span>
                  {#if connection.differs && accounts.canManage}
                    <Button
                      size="xs"
                      variant="outline"
                      onclick={() => (accepting = { connectionId: connection.connectionId, connectionName: connection.connectionName })}
                    >
                      {t("monitoring.accounts.accept")}
                    </Button>
                  {/if}
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if current.events.length > 0}
      <ul class="m-0 mt-3 list-none space-y-1 p-0" aria-label={t("monitoring.events")}>
        {#each current.events.slice(0, 10) as event (event.id)}
          <li class="flex items-center gap-2" data-kind={event.kind} data-status={event.status}>
            <Badge tone={STATUS_TONE[event.status]}>{t(`monitoring.status.${event.status}`)}</Badge>
            <span class="shrink-0 text-text-muted">{formatDateTime(parseServerTime(event.detectedAt), i18n.locale)}</span>
            <span class="shrink-0 font-semibold">{t(`monitoring.kind.${event.kind}`)}</span>
            <span class="shrink-0 text-text-secondary">{event.connectionName ?? ""}</span>
            <span class="min-w-0 flex-1 truncate font-mono">{summary(event)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if monitoring.error ?? save.error ?? check.error ?? watchAccounts.error}
    <ErrorText>{monitoring.error ?? save.error ?? check.error ?? watchAccounts.error}</ErrorText>
  {/if}
  {#if accepting}
    <ConfirmDialog
      title={t("monitoring.accounts.acceptTitle")}
      message={t("monitoring.accounts.acceptMessage", { connection: accepting.connectionName })}
      confirmLabel={t("monitoring.accounts.accept")}
      danger="warning"
      pending={accept.pending}
      error={accept.error}
      onConfirm={() => void accept.run()}
      onCancel={() => (accepting = null)}
    />
  {/if}
</section>
