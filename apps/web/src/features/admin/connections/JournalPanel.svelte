<script lang="ts" module>
  /** How far back the events look, in hours; `0` for everything kept. */
  const PERIODS = [24, 24 * 7, 24 * 30, 24 * 90, 0] as const;
  type Period = (typeof PERIODS)[number];
  /** How far back the statement figures look, in days; `0` for every day kept. */
  const STAT_DAYS = [1, 7, 30, 0] as const;
  type StatDays = (typeof STAT_DAYS)[number];

  /** `YYYY-MM-DD HH:MM:SS` UTC, the audit log's own format. */
  function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
  }
</script>

<script lang="ts">
  import type { DbQueryStatSort } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, DownloadIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    ACTIVITY_CATEGORIES,
    activityExportUrl,
    fetchActivity,
    type ActivityCategory,
    type ActivityEntry,
    type ActivityFilters,
  } from "@/services/activityApi";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import {
    fetchDbActivity,
    fetchDbTraffic,
    fetchJournalActors,
    fetchQueryStats,
    sampleDbActivity,
    setDbActivityWatch,
  } from "@/services/connectionJournalApi";

  /**
   * One database's journal, in its console: what was done to it through
   * Nebula — the console opened, connections tested, statements run (their
   * text cut, duration, rows, author), deployments and rollbacks, account
   * changes, what the watch found. The audit log filtered on this database
   * (the same entries and export as Admin → Activité), and, under
   * "Requêtes", the statements of the SQL console counted by shape — timed
   * by Nebula, never by the database server.
   */
  let { connectionId }: { connectionId: string } = $props();

  const { t } = useTranslation();
  let view = $state<"events" | "queries" | "dbside">("events");

  // ---- Events ----------------------------------------------------------------
  let period = $state<Period>(24 * 7);
  let category = $state<ActivityCategory | "">("");
  let actorId = $state("");
  let expanded = $state<string | null>(null);
  let extra = $state.raw<ActivityEntry[]>([]);
  let moreCursor = $state<number | null | undefined>(undefined);

  const filters = $derived<ActivityFilters>({
    connectionId,
    from: period ? hoursAgo(period) : undefined,
    category: category || undefined,
    actorId: actorId || undefined,
  });
  const firstPage = useAsyncResource(() => {
    const current = filters;
    extra = [];
    moreCursor = undefined;
    return fetchActivity(current);
  });
  const entries = $derived([...(firstPage.data?.entries ?? []), ...extra]);
  const cursor = $derived(moreCursor === undefined ? (firstPage.data?.nextCursor ?? null) : moreCursor);
  const more = useAsyncAction(async () => {
    const page = await fetchActivity(filters, cursor);
    extra = [...extra, ...page.entries];
    moreCursor = page.nextCursor;
  });
  const actors = useAsyncResource(() => fetchJournalActors(connectionId));

  const periodOptions = $derived(
    PERIODS.map((value) => ({ value, label: t(`activity.period.${value}` as "activity.period.24") })),
  );
  const categoryOptions = $derived([
    { value: "" as const, label: t("activity.allTypes") },
    ...ACTIVITY_CATEGORIES.map((value) => ({ value, label: t(`activity.category.${value}`) })),
  ]);
  const actorOptions = $derived([
    { value: "", label: t("activity.allActors") },
    ...(actors.data ?? []).map((a) => ({ value: a.id, label: a.name ?? a.email ?? a.id })),
  ]);

  // ---- Statement figures ------------------------------------------------------
  let statDays = $state<StatDays>(7);
  let sort = $state<DbQueryStatSort>("frequency");
  const stats = useAsyncResource(() => {
    const options = { days: statDays, sort };
    return view === "queries" ? fetchQueryStats(connectionId, options) : Promise.resolve(null);
  });
  const statDaysOptions = $derived(
    STAT_DAYS.map((value) => ({ value, label: t(`journal.queries.days.${value}` as "journal.queries.days.1") })),
  );
  const sortOptions = $derived(
    (["frequency", "slowest", "total"] as const).map((value) => ({ value, label: t(`journal.queries.sort.${value}`) })),
  );
  // ---- Database-side activity -------------------------------------------------
  let outsideOnly = $state(true);
  let activityDays = $state<StatDays>(1);
  const activity = useAsyncResource(() =>
    view === "dbside"
      ? fetchDbActivity(connectionId, { days: activityDays || 3650, outside: outsideOnly })
      : Promise.resolve(null),
  );
  const traffic = useAsyncResource(() =>
    view === "dbside" ? fetchDbTraffic(connectionId, activityDays === 1 ? 1 : activityDays === 7 ? 7 : 30) : Promise.resolve(null),
  );
  const sampleNow = useAsyncAction(async () => {
    await sampleDbActivity(connectionId);
    activity.reload();
    traffic.reload();
  });
  const bytes = (value: number | null) => {
    if (value === null) return "—";
    if (value < 1024) return `${value} o`;
    const units = ["Ko", "Mo", "Go", "To"];
    let n = value / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toLocaleString(i18n.locale, { maximumFractionDigits: 1 })} ${units[i]}`;
  };
  const toggleWatch = useAsyncAction(async (enabled: boolean) => {
    await setDbActivityWatch(connectionId, enabled);
    activity.reload();
  });
  const ms = (value: number) =>
    value >= 1000 ? `${(value / 1000).toLocaleString(i18n.locale, { maximumFractionDigits: 1 })} s` : `${value} ms`;
</script>

<div data-testid="connection-journal">
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <SegmentedControl
      size="sm"
      aria-label={t("journal.view")}
      value={view}
      options={[
        { value: "events" as const, label: t("journal.events") },
        { value: "queries" as const, label: t("journal.queries") },
        { value: "dbside" as const, label: t("journal.dbside") },
      ]}
      onChange={(value) => (view = value)}
    />
  </div>

  {#if view === "events"}
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <Select
        size="sm"
        class="w-40"
        aria-label={t("activity.period")}
        value={period}
        options={periodOptions}
        onChange={(value) => (period = value)}
      />
      <Select
        size="sm"
        class="w-40"
        aria-label={t("activity.type")}
        value={category}
        options={categoryOptions}
        onChange={(value) => (category = value)}
      />
      <Select
        size="sm"
        class="w-48"
        aria-label={t("journal.author")}
        value={actorId}
        options={actorOptions}
        onChange={(value) => (actorId = value)}
      />
      <span class="flex-1"></span>
      <a
        class="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
        href={activityExportUrl(filters, "csv")}
        download
      >
        <Icon icon={DownloadIcon} size={13} />{t("activity.exportCsv")}
      </a>
      <a
        class="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
        href={activityExportUrl(filters, "json")}
        download
      >
        <Icon icon={DownloadIcon} size={13} />{t("activity.exportJson")}
      </a>
    </div>

    {#if firstPage.error ?? more.error}<ErrorText>{firstPage.error ?? more.error}</ErrorText>{/if}
    {#if !firstPage.loading && entries.length === 0}
      <EmptyState>{t("journal.empty")}</EmptyState>
    {:else}
      <ul class="m-0 list-none divide-y divide-border/60 rounded-lg border border-border p-0" aria-label={t("journal.events")}>
        {#each entries as entry (entry.id)}
          {@const open = expanded === entry.id}
          <li data-testid="journal-entry" data-action={entry.action}>
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2 text-left text-[12.5px] hover:bg-surface-hover"
              aria-expanded={open}
              onclick={() => (expanded = open ? null : entry.id)}
            >
              <span class="w-[130px] shrink-0 text-xs text-text-muted">
                {formatDateTime(parseServerTime(entry.createdAt), i18n.locale)}
              </span>
              <span class="w-[96px] shrink-0 text-[10px] font-bold uppercase text-text-secondary">
                {t(`activity.category.${entry.category}`)}
              </span>
              <span class="w-[140px] shrink-0 truncate">{entry.actorName ?? entry.actorEmail ?? t("journal.system")}</span>
              <span class="shrink-0 font-mono text-[11.5px]">{entry.action}</span>
              <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">
                {[entry.projectName, entry.detail].filter(Boolean).join(" · ")}
              </span>
              <Icon icon={ChevronRightIcon} size={12} class={`shrink-0 text-text-muted ${open ? "rotate-90" : ""}`} />
            </button>
            {#if open}
              <dl class="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1 bg-surface-raised px-4 py-3 text-xs">
                <dt class="text-text-muted">{t("activity.field.actor")}</dt>
                <dd class="m-0">{[entry.actorName, entry.actorEmail].filter(Boolean).join(" — ") || t("journal.system")}</dd>
                {#if entry.detail}
                  <dt class="text-text-muted">{t("activity.field.detail")}</dt>
                  <dd class="m-0 whitespace-pre-wrap break-words font-mono">{entry.detail}</dd>
                {/if}
                {#if entry.projectId}
                  <dt class="text-text-muted">{t("activity.field.project")}</dt>
                  <dd class="m-0">{entry.projectName ?? t("activity.deleted")}</dd>
                {/if}
                <dt class="text-text-muted">{t("activity.field.ip")}</dt>
                <dd class="m-0 font-mono">{entry.ip ?? "—"}</dd>
              </dl>
            {/if}
          </li>
        {/each}
      </ul>
      {#if cursor}
        <div class="mt-2 flex justify-center">
          <Button size="sm" variant="ghost" onclick={() => void more.run()} disabled={more.pending}>
            {more.pending ? t("common.loading") : t("activity.more")}
          </Button>
        </div>
      {/if}
    {/if}
    <Hint>{t("journal.scopeNote")}</Hint>
  {:else if view === "dbside"}
    <div class="mb-3 flex flex-wrap items-center gap-3">
      <Select
        size="sm"
        class="w-40"
        aria-label={t("activity.period")}
        value={activityDays}
        options={statDaysOptions}
        onChange={(value) => (activityDays = value)}
      />
      <Checkbox checked={outsideOnly} onChange={(checked) => (outsideOnly = checked)}>
        {t("journal.dbside.outsideOnly")}
      </Checkbox>
      <span class="flex-1"></span>
      {#if activity.data}
        <Checkbox
          checked={activity.data.watch.enabled}
          disabled={toggleWatch.pending}
          onChange={(checked) => void toggleWatch.run(checked)}
        >
          {t("journal.dbside.watch")}
        </Checkbox>
      {/if}
      <Button size="sm" variant="outline" onclick={() => void sampleNow.run()} disabled={sampleNow.pending}>
        {sampleNow.pending ? t("common.loading") : t("journal.dbside.sampleNow")}
      </Button>
    </div>
    {#if activity.error ?? sampleNow.error ?? toggleWatch.error}
      <ErrorText>{activity.error ?? sampleNow.error ?? toggleWatch.error}</ErrorText>
    {/if}
    {#if activity.data?.watch.lastError}
      <ErrorText>{t("journal.dbside.lastError", { error: activity.data.watch.lastError })}</ErrorText>
    {/if}
    {#if activity.data && activity.data.entries.length === 0}
      <EmptyState>{t("journal.dbside.empty")}</EmptyState>
    {:else if activity.data}
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full border-collapse text-[12px]" aria-label={t("journal.dbside")}>
          <thead class="bg-surface-raised text-left text-[11px] text-text-muted">
            <tr>
              <th class="px-3 py-1.5 font-semibold">{t("journal.dbside.account")}</th>
              <th class="px-2 py-1.5 font-semibold">{t("journal.dbside.client")}</th>
              <th class="px-2 py-1.5 font-semibold">{t("journal.queries.statement")}</th>
              <th class="px-2 py-1.5 text-right font-semibold">{t("journal.dbside.seen")}</th>
              <th class="px-2 py-1.5 text-right font-semibold">{t("journal.dbside.longest")}</th>
              <th class="px-3 py-1.5 font-semibold">{t("journal.queries.last")}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border/60">
            {#each activity.data.entries as entry (entry.fingerprint)}
              <tr data-testid="db-activity" data-user={entry.user ?? ""}>
                <td class="px-3 py-1.5">
                  {entry.user ?? "—"}
                  {#if entry.knownAccount}<Badge tone="muted">{t("journal.dbside.nebulaAccount")}</Badge>{/if}
                </td>
                <td class="px-2 py-1.5 text-text-muted">{[entry.client, entry.database].filter(Boolean).join(" · ") || "—"}</td>
                <td class="max-w-[360px] truncate px-2 py-1.5 font-mono text-[11.5px]" title={entry.sql}>
                  {entry.sql || t("journal.dbside.noStatement")}
                </td>
                <td class="px-2 py-1.5 text-right tabular-nums">{entry.seen}</td>
                <td class="px-2 py-1.5 text-right tabular-nums">{entry.maxSeconds} s</td>
                <td class="px-3 py-1.5 text-text-muted">{formatDateTime(parseServerTime(entry.lastAt), i18n.locale)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if traffic.data}
      <div class="mt-4 mb-2 flex items-center gap-2">
        <h4 class="m-0 text-xs font-bold text-text">{t("journal.dbside.traffic")}</h4>
        {#if traffic.data.kind}
          <span data-tooltip={t("journal.dbside.trafficHint")}>
            <Badge tone="muted">{t(`journal.dbside.kind.${traffic.data.kind}`)}</Badge>
          </span>
        {/if}
      </div>
      {#if traffic.data.buckets.length === 0}
        <EmptyState>{t("journal.dbside.trafficEmpty")}</EmptyState>
      {:else}
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full border-collapse text-[12px]" aria-label={t("journal.dbside.traffic")}>
            <thead class="bg-surface-raised text-left text-[11px] text-text-muted">
              <tr>
                <th class="px-3 py-1.5 font-semibold">{t("journal.dbside.period")}</th>
                <th class="px-2 py-1.5 text-right font-semibold">{t("journal.dbside.queries")}</th>
                <th class="px-2 py-1.5 text-right font-semibold">{t("journal.dbside.sent")}</th>
                <th class="px-2 py-1.5 text-right font-semibold">{t("journal.dbside.received")}</th>
                <th class="px-2 py-1.5 text-right font-semibold">{t("journal.dbside.rowsRead")}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/60">
              {#each traffic.data.buckets as bucket (bucket.start)}
                <tr data-testid="db-traffic">
                  <td class="px-3 py-1.5 text-text-muted">{formatDateTime(parseServerTime(bucket.start), i18n.locale)}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums">{bucket.queries ?? "—"}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums">{bytes(bucket.bytesOut)}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums">{bytes(bucket.bytesIn)}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums">{bucket.rows ?? "—"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
    <Hint>{t("journal.dbside.note")}</Hint>
  {:else}
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <Select
        size="sm"
        class="w-40"
        aria-label={t("activity.period")}
        value={statDays}
        options={statDaysOptions}
        onChange={(value) => (statDays = value)}
      />
      <SegmentedControl
        size="sm"
        aria-label={t("journal.queries.sortBy")}
        value={sort}
        options={sortOptions}
        onChange={(value) => (sort = value)}
      />
      <span class="flex-1"></span>
      <span data-tooltip={t("journal.queries.measuredHint")}>
        <Badge tone="muted">{t("journal.queries.measured")}</Badge>
      </span>
    </div>
    {#if stats.error}<ErrorText>{stats.error}</ErrorText>{/if}
    {#if stats.data && stats.data.length === 0}
      <EmptyState>{t("journal.queries.empty")}</EmptyState>
    {:else if stats.data}
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full border-collapse text-[12px]" aria-label={t("journal.queries")}>
          <thead class="bg-surface-raised text-left text-[11px] text-text-muted">
            <tr>
              <th class="px-3 py-1.5 font-semibold">{t("journal.queries.statement")}</th>
              <th class="px-2 py-1.5 text-right font-semibold">{t("journal.queries.executions")}</th>
              <th class="px-2 py-1.5 text-right font-semibold">{t("journal.queries.avg")}</th>
              <th class="px-2 py-1.5 text-right font-semibold">{t("journal.queries.max")}</th>
              <th class="px-2 py-1.5 text-right font-semibold">{t("journal.queries.total")}</th>
              <th class="px-2 py-1.5 text-right font-semibold">{t("journal.queries.rows")}</th>
              <th class="px-3 py-1.5 font-semibold">{t("journal.queries.last")}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border/60">
            {#each stats.data as stat (stat.hash)}
              <tr data-testid="query-stat">
                <td class="max-w-[420px] truncate px-3 py-1.5 font-mono text-[11.5px]" title={stat.sql}>{stat.sql}</td>
                <td class="px-2 py-1.5 text-right tabular-nums">
                  {stat.executions}
                  {#if stat.failures > 0}
                    <span class="text-danger" title={t("journal.queries.failures")}>({stat.failures}✕)</span>
                  {/if}
                </td>
                <td class="px-2 py-1.5 text-right tabular-nums">{ms(stat.avgMs)}</td>
                <td class="px-2 py-1.5 text-right tabular-nums">{ms(stat.maxMs)}</td>
                <td class="px-2 py-1.5 text-right tabular-nums">{ms(stat.totalMs)}</td>
                <td class="px-2 py-1.5 text-right tabular-nums">{stat.avgRows ?? "—"}</td>
                <td class="px-3 py-1.5 text-text-muted">
                  {formatDateTime(parseServerTime(stat.lastAt), i18n.locale)}
                  {#if stat.lastUserName}· {stat.lastUserName}{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <Hint>{t("journal.queries.note")}</Hint>
  {/if}
</div>
