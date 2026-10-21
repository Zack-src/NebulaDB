<script lang="ts">
  import { MONITOR_INTERVALS, MONITOR_MUTE_MINUTES, type AccountChange, type DriftEvent } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, PlusIcon, RestoreIcon, SearchIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Popover from "@/components/ui/Popover.svelte";
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
    acknowledgeEvent,
    fetchMonitoring,
    muteAlerts,
    runMonitoringCheck,
    saveMonitoring,
    setAccountWatch,
    unmuteAlerts,
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
  let {
    projectId,
    canManage,
    canCheck,
    tableNames = [],
  }: {
    projectId: string;
    /** The project's administrators: switching the watch on or off, its pace, the tables it ignores. */
    canManage: boolean;
    /** Those who may deploy: having it look now. */
    canCheck: boolean;
    /** The tables of the project's current schema, offered in the ignore picker. */
    tableNames?: string[];
  } = $props();

  /** The server's limits on the ignored list (`parseMonitorSettings`). */
  const MAX_IGNORE_TABLES = 200;
  const MAX_IGNORE_NAME = 128;

  const { t } = useTranslation();
  const monitoring = useAsyncResource(() => fetchMonitoring(projectId));
  let override = $state.raw<MonitoringState | null>(null);
  const current = $derived(override ?? monitoring.data);
  /** The ignored list while a save is in flight; `null` shows the saved one. */
  let ignoreDraft = $state<string[] | null>(null);
  let pickerOpen = $state(false);
  let pickerAnchor = $state<HTMLElement | null>(null);
  let pickerQuery = $state("");

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
  /** The open finding an administrator is about to take note of, with the note being typed. */
  let acknowledging = $state<{ id: string; note: string } | null>(null);
  const acknowledge = useAsyncAction(async () => {
    if (!acknowledging) return;
    override = await acknowledgeEvent(projectId, acknowledging.id, acknowledging.note);
    acknowledging = null;
  });
  /** The mute being set (duration and reason), while its form is open. */
  let muting = $state<{ minutes: number; reason: string } | null>(null);
  const mute = useAsyncAction(async () => {
    if (!muting) return;
    const settings = await muteAlerts(projectId, muting.minutes, muting.reason);
    if (current) override = { ...current, settings };
    muting = null;
  });
  const unmute = useAsyncAction(async () => {
    const settings = await unmuteAlerts(projectId);
    if (current) override = { ...current, settings };
  });
  /** The database whose current accounts are about to become the reference. */
  let accepting = $state<{ connectionId: string; connectionName: string } | null>(null);
  const accept = useAsyncAction(async () => {
    if (!accepting) return;
    override = await acceptAccountState(projectId, accepting.connectionId);
    accepting = null;
  });

  const ignored = $derived(ignoreDraft ?? current?.settings.ignoreTables ?? []);
  const ignoredSet = $derived(new Set(ignored));
  // Names the server would refuse are not offered; the list is capped as it is.
  const pickable = $derived([...new Set(tableNames)].filter((name) => name.length <= MAX_IGNORE_NAME));
  const matches = $derived.by(() => {
    const needle = pickerQuery.trim().toLowerCase();
    return needle ? pickable.filter((name) => name.toLowerCase().includes(needle)) : pickable;
  });
  // A name typed in full that is neither in the schema nor already ignored: a table only the database has.
  const typedName = $derived(pickerQuery.trim());
  const canAddTyped = $derived(typedName !== "" && !pickable.includes(typedName) && !ignoredSet.has(typedName));
  const listFull = $derived(ignored.length >= MAX_IGNORE_TABLES);

  async function commitIgnore(ignoreTables: string[]) {
    ignoreDraft = ignoreTables;
    await save.run({ ignoreTables });
    ignoreDraft = null;
  }
  function toggleIgnored(name: string, on: boolean) {
    if (on ? listFull || ignoredSet.has(name) : !ignoredSet.has(name)) return;
    void commitIgnore(on ? [...ignored, name] : ignored.filter((entry) => entry !== name));
  }
  function addTyped() {
    if (!canAddTyped || listFull) return;
    toggleIgnored(typedName, true);
    pickerQuery = "";
  }
  function closePicker() {
    pickerOpen = false;
    pickerQuery = "";
  }

  const intervalOptions = $derived(
    MONITOR_INTERVALS.map((minutes) => ({ value: minutes, label: t(`monitoring.every.${minutes}` as "monitoring.every.5") })),
  );
  const muteOptions = $derived(
    MONITOR_MUTE_MINUTES.map((minutes) => ({ value: minutes, label: t(`monitoring.mute.for.${minutes}` as "monitoring.mute.for.60") })),
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
  const busy = $derived(save.pending || check.pending || watchAccounts.pending || mute.pending || unmute.pending);
  // Imposed from a connection (Admin → Connexions): on and paced there; the ignored tables are the instance administrators'.
  const forced = $derived(current?.settings.forced ?? null);
  const instanceAdmin = $derived(current?.accounts != null);
  const ignoreDisabled = $derived(!canManage || busy || (forced !== null && !instanceAdmin));
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
      {#if canCheck}
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
      <div class="flex min-w-[200px] flex-1 flex-wrap items-center gap-1.5" role="group" aria-label={t("monitoring.ignore")}>
        {#each ignored as name (name)}
          <span
            class="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-hover py-px pl-2 pr-1 font-mono text-text"
            data-testid="monitoring-ignored"
          >
            <span class="truncate">{name}</span>
            <button
              type="button"
              class="flex rounded-full text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t("monitoring.ignoreRemove", { name })}
              disabled={ignoreDisabled}
              onclick={() => toggleIgnored(name, false)}
            >
              <Icon icon={CloseIcon} size={10} />
            </button>
          </span>
        {:else}
          <span class="text-text-muted">{t("monitoring.ignoreNone")}</span>
        {/each}
        <span bind:this={pickerAnchor} class="inline-flex">
          <Button
            size="xs"
            variant="outline"
            onclick={() => (pickerOpen ? closePicker() : (pickerOpen = true))}
            disabled={ignoreDisabled}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            <Icon icon={PlusIcon} size={12} />
            {t("monitoring.ignoreAdd")}
          </Button>
        </span>
      </div>
      <Popover open={pickerOpen} anchor={pickerAnchor} onClose={closePicker} class="w-72 p-2" role="dialog" aria-label={t("monitoring.ignore")}>
        <Input
          inputSize="sm"
          autofocus
          maxlength={MAX_IGNORE_NAME}
          aria-label={t("monitoring.ignoreSearch")}
          placeholder={t("monitoring.ignoreSearch")}
          bind:value={pickerQuery}
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTyped();
            }
          }}
        >
          {#snippet icon()}<Icon icon={SearchIcon} size={13} />{/snippet}
        </Input>
        {#if canAddTyped}
          <Button class="mt-1.5 w-full" size="xs" variant="outline" onclick={addTyped} disabled={listFull}>
            {t("monitoring.ignoreAddName", { name: typedName })}
          </Button>
        {/if}
        <ul class="m-0 mt-1.5 max-h-56 list-none space-y-0.5 overflow-y-auto p-0" aria-label={t("monitoring.ignoreTables")}>
          {#each matches as name (name)}
            {@const on = ignoredSet.has(name)}
            <li class="rounded-sm px-1 py-0.5 hover:bg-surface-hover">
              <Checkbox checked={on} disabled={!on && listFull} onChange={(checked) => toggleIgnored(name, checked)} class="w-full">
                <span class="font-mono">{name}</span>
              </Checkbox>
            </li>
          {:else}
            <li class="px-1 py-1 text-text-muted">{t("monitoring.ignoreNoMatch")}</li>
          {/each}
        </ul>
        {#if listFull}
          <p class="m-0 mt-1.5 text-text-muted">{t("monitoring.ignoreFull", { max: MAX_IGNORE_TABLES })}</p>
        {/if}
      </Popover>
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

    <div class="mt-2" data-testid="monitoring-mute">
      {#if current.settings.mute}
        {@const muted = current.settings.mute}
        <p class="m-0 flex flex-wrap items-center gap-2">
          <Badge tone="warning">{t("monitoring.mute.badge")}</Badge>
          <span class="min-w-0 flex-1 text-text-secondary">
            {t("monitoring.mute.detail", {
              until: formatDateTime(parseServerTime(muted.until), i18n.locale),
              name: muted.by,
              reason: muted.reason,
            })}
          </span>
          {#if canManage}
            <Button size="xs" variant="outline" onclick={() => void unmute.run()} disabled={busy}>
              {unmute.pending ? t("common.loading") : t("monitoring.mute.lift")}
            </Button>
          {/if}
        </p>
      {:else if canManage}
        {#if muting}
          <form
            class="flex flex-wrap items-center gap-2"
            onsubmit={(submitEvent) => {
              submitEvent.preventDefault();
              void mute.run();
            }}
          >
            <Select
              size="sm"
              class="w-40"
              aria-label={t("monitoring.mute.duration")}
              value={muting.minutes}
              options={muteOptions}
              onChange={(minutes) => muting && (muting.minutes = minutes)}
            />
            <Input inputSize="sm"
              class="min-w-[200px] flex-1"
              aria-label={t("monitoring.mute.reason")}
              placeholder={t("monitoring.mute.reason")}
              maxlength={200}
              required
              bind:value={muting.reason}
            />
            <Button size="xs" variant="primary" type="submit" disabled={busy || !muting.reason.trim()}>
              {mute.pending ? t("common.loading") : t("monitoring.mute.confirm")}
            </Button>
            <Button size="xs" variant="ghost" onclick={() => (muting = null)} disabled={busy}>{t("common.cancel")}</Button>
          </form>
        {:else}
          <Button
            size="xs"
            variant="outline"
            onclick={() => (muting = { minutes: MONITOR_MUTE_MINUTES[0], reason: "" })}
            disabled={busy || (forced !== null && !instanceAdmin)}
          >
            {t("monitoring.mute.start")}
          </Button>
          {#if forced !== null && !instanceAdmin}
            <Hint>{t("monitoring.mute.forcedHint")}</Hint>
          {/if}
        {/if}
      {/if}
    </div>

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
          <li class="flex flex-wrap items-center gap-x-2 gap-y-1" data-kind={event.kind} data-status={event.status}>
            <Badge tone={STATUS_TONE[event.status]}>{t(`monitoring.status.${event.status}`)}</Badge>
            {#if event.acknowledgement}
              <Badge tone="warning">{t("monitoring.acknowledged")}</Badge>
            {/if}
            <span class="shrink-0 text-text-muted">{formatDateTime(parseServerTime(event.detectedAt), i18n.locale)}</span>
            <span class="shrink-0 font-semibold">{t(`monitoring.kind.${event.kind}`)}</span>
            <span class="shrink-0 text-text-secondary">{event.connectionName ?? ""}</span>
            <span class="min-w-0 flex-1 truncate font-mono">{summary(event)}</span>
            {#if canManage && event.status === "open" && !event.acknowledgement}
              <Button size="xs" variant="outline" onclick={() => (acknowledging = { id: event.id, note: "" })} disabled={busy}>
                {t("monitoring.acknowledge")}
              </Button>
            {/if}
            {#if event.acknowledgement}
              <span class="w-full pl-1 text-text-muted" data-testid="monitoring-acknowledgement">
                {t("monitoring.acknowledgedBy", {
                  name: event.acknowledgement.by,
                  when: formatDateTime(parseServerTime(event.acknowledgement.at), i18n.locale),
                })}
                {#if event.acknowledgement.note}<span class="italic">« {event.acknowledgement.note} »</span>{/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if acknowledging}
        <form
          class="mt-2 flex flex-wrap items-center gap-2"
          onsubmit={(submitEvent) => {
            submitEvent.preventDefault();
            void acknowledge.run();
          }}
        >
          <Input inputSize="sm"
            class="min-w-[200px] flex-1"
            aria-label={t("monitoring.acknowledgeNote")}
            placeholder={t("monitoring.acknowledgeNote")}
            maxlength={500}
            bind:value={acknowledging.note}
          />
          <Button size="xs" variant="primary" type="submit" disabled={acknowledge.pending}>
            {acknowledge.pending ? t("common.loading") : t("monitoring.acknowledge")}
          </Button>
          <Button size="xs" variant="ghost" onclick={() => (acknowledging = null)} disabled={acknowledge.pending}>
            {t("common.cancel")}
          </Button>
        </form>
      {/if}
    {/if}
  {/if}
  {#if monitoring.error ?? save.error ?? check.error ?? watchAccounts.error ?? acknowledge.error ?? mute.error ?? unmute.error}
    <ErrorText>{monitoring.error ?? save.error ?? check.error ?? watchAccounts.error ?? acknowledge.error ?? mute.error ?? unmute.error}</ErrorText>
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
