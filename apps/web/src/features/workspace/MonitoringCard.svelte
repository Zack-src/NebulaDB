<script lang="ts">
  import { MONITOR_INTERVALS } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, PlusIcon, RestoreIcon, SearchIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Popover from "@/components/ui/Popover.svelte";
  import Select from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchMonitoringSettings, runMonitoringCheck, saveMonitoring } from "@/services/monitoringApi";
  import {
    MAX_IGNORE_NAME,
    MAX_IGNORE_TABLES,
    matchingTables,
    pickableTables,
    toggleIgnoredTable,
    typedTableName,
  } from "./monitoringIgnore";

  /**
   * "Surveillance": whether the project's databases are read on a schedule and compared with the
   * state left by the last deployment or pull, how often, and which tables are left out. Only the
   * settings live here; what the watch finds shows in the editor's drift banner and the webhooks.
   * Shown to the project's administrators — the server refuses anyone else.
   */
  let {
    projectId,
    canCheck,
    instanceAdmin = false,
    tableNames = [],
  }: {
    projectId: string;
    /** Those who may deploy: having it look now. */
    canCheck: boolean;
    /** An instance administrator: when a connection imposes the watch, the ignored tables are theirs alone. */
    instanceAdmin?: boolean;
    /** The tables of the project's current schema, offered in the ignore picker. */
    tableNames?: string[];
  } = $props();

  const { t } = useTranslation();
  const resource = useAsyncResource(() => fetchMonitoringSettings(projectId));
  let override = $state.raw<Awaited<ReturnType<typeof fetchMonitoringSettings>> | null>(null);
  const settings = $derived(override ?? resource.data);
  /** The ignored list while a save is in flight; `null` shows the saved one. */
  let ignoreDraft = $state<string[] | null>(null);
  let pickerOpen = $state(false);
  let pickerAnchor = $state<HTMLElement | null>(null);
  let pickerQuery = $state("");

  const save = useAsyncAction(async (patch: { enabled?: boolean; intervalMinutes?: number; ignoreTables?: string[] }) => {
    if (!settings) return;
    override = await saveMonitoring(projectId, {
      enabled: patch.enabled ?? settings.enabled,
      intervalMinutes: patch.intervalMinutes ?? settings.intervalMinutes,
      ignoreTables: patch.ignoreTables ?? settings.ignoreTables,
    });
  });
  const check = useAsyncAction(async () => {
    override = await runMonitoringCheck(projectId);
  });

  const ignored = $derived(ignoreDraft ?? settings?.ignoreTables ?? []);
  const pickable = $derived(pickableTables(tableNames));
  const matches = $derived(matchingTables(pickable, pickerQuery));
  const typedName = $derived(typedTableName(pickable, ignored, pickerQuery));
  const listFull = $derived(ignored.length >= MAX_IGNORE_TABLES);
  const busy = $derived(save.pending || check.pending);
  // Imposed from a connection: on and paced there; only the ignored tables stay the project's to change.
  const forced = $derived(settings?.forced ?? null);

  async function commitIgnore(ignoreTables: string[]) {
    ignoreDraft = ignoreTables;
    await save.run({ ignoreTables });
    ignoreDraft = null;
  }
  function toggleIgnored(name: string, on: boolean) {
    const next = toggleIgnoredTable(ignored, name, on);
    if (next !== ignored) void commitIgnore(next);
  }
  function addTyped() {
    if (!typedName) return;
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
</script>

<section class="rounded-md border border-border bg-surface p-3 text-xs" aria-labelledby="monitoring-title" data-testid="monitoring">
  <div class="mb-2 flex flex-wrap items-center gap-2">
    <h3 id="monitoring-title" class="m-0 flex-1 text-body-sm font-semibold text-text">{t("monitoring.title")}</h3>
    {#if settings}
      <span class="text-text-muted">
        {settings.lastCheckedAt
          ? t("monitoring.lastChecked", { when: formatRelativeTime(parseServerTime(settings.lastCheckedAt), i18n.locale) })
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

  {#if settings}
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="flex items-center gap-2">
        <Switch
          size="sm"
          checked={settings.enabled}
          disabled={busy || forced !== null}
          onChange={(enabled) => void save.run({ enabled })}
          aria-label={t("monitoring.enable")}
        />
        <span>{t("monitoring.enable")}</span>
      </span>
      <Select
        size="sm"
        class="w-44"
        aria-label={t("monitoring.interval")}
        value={settings.intervalMinutes}
        options={intervalOptions}
        disabled={busy || forced !== null}
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
              disabled={busy || (forced !== null && !instanceAdmin)}
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
            disabled={busy || (forced !== null && !instanceAdmin)}
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
        {#if typedName}
          <Button class="mt-1.5 w-full" size="xs" variant="outline" onclick={addTyped} disabled={listFull}>
            {t("monitoring.ignoreAddName", { name: typedName })}
          </Button>
        {/if}
        <ul class="m-0 mt-1.5 max-h-56 list-none space-y-0.5 overflow-y-auto p-0" aria-label={t("monitoring.ignoreTables")}>
          {#each matches as name (name)}
            {@const on = ignored.includes(name)}
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
        {t("monitoring.forced", {
          connections: forced.connections.join(", "),
          interval: t(`monitoring.every.${forced.intervalMinutes}` as "monitoring.every.5"),
        })}
      </p>
    {/if}
  {/if}
  {#if resource.error ?? save.error ?? check.error}
    <ErrorText>{resource.error ?? save.error ?? check.error}</ErrorText>
  {/if}
</section>
