<script lang="ts" module>
  /** How far back the view looks, in hours; `0` for everything kept. */
  const PERIODS = [24, 24 * 7, 24 * 30, 24 * 90, 0] as const;
  type Period = (typeof PERIODS)[number];

  /** `YYYY-MM-DD HH:MM:SS` UTC, the audit log's own format. */
  function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
  }

  /** What stands out in a long list. */
  const SEVERE = /^(project\.delete|user\.(delete|disable)|auth\.login\.(mfa_)?locked|connection\.(deploy|rollback)|dbadmin\.(drop|structure\.)|table\.unlock)/;
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, DownloadIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
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
  import { listAdminConnections } from "@/services/dbAdminApi";
  import { fetchProjects } from "@/services/projectsApi";

  /**
   * Admin → Activité: everything done through Athanor that the audit trail
   * keeps — deployments, structure, data writes, accounts, sessions,
   * configuration — in one list, filtered by period, type, project, database
   * and text, a page at a time, exportable. Read-only: there is no way to
   * edit or delete an entry, here or anywhere.
   */
  const { t } = useTranslation();
  let period = $state<Period>(24 * 7);
  let category = $state<ActivityCategory | "">("");
  let projectId = $state("");
  let connectionId = $state("");
  /** Set from an entry: "everything this person did". Not a list to pick from — the journal names its own actors. */
  let actor = $state.raw<{ id: string; label: string } | null>(null);
  let search = $state("");
  let searchDraft = $state("");
  let expanded = $state<string | null>(null);
  let extra = $state.raw<ActivityEntry[]>([]);
  /** The cursor after the pages loaded with "more"; `undefined` until one is. */
  let moreCursor = $state<number | null | undefined>(undefined);

  const filters = $derived<ActivityFilters>({
    from: period ? hoursAgo(period) : undefined,
    category: category || undefined,
    projectId: projectId || undefined,
    connectionId: connectionId || undefined,
    actorId: actor?.id,
    search: search || undefined,
  });

  // New filters start over from the first page.
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

  const projects = useAsyncResource(fetchProjects);
  const connections = useAsyncResource(listAdminConnections);
  const periodOptions = $derived(
    PERIODS.map((value) => ({ value, label: t(`activity.period.${value}` as "activity.period.24") })),
  );
  const categoryOptions = $derived([
    { value: "" as const, label: t("activity.allTypes") },
    ...ACTIVITY_CATEGORIES.map((value) => ({ value, label: t(`activity.category.${value}`) })),
  ]);
  const projectOptions = $derived([
    { value: "", label: t("activity.allProjects") },
    ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ]);
  const connectionOptions = $derived([
    { value: "", label: t("activity.allConnections") },
    ...(connections.data ?? []).map((c) => ({ value: c.id, label: c.name })),
  ]);

  const CATEGORY_TONE: Record<ActivityCategory, string> = {
    structure: "text-warning",
    data: "text-info",
    deployments: "text-primary",
    accounts: "text-text",
    sessions: "text-text-muted",
    monitoring: "text-danger",
    projects: "text-success",
    configuration: "text-text-secondary",
  };
</script>

<div>
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
      class="w-44"
      aria-label={t("activity.project")}
      value={projectId}
      options={projectOptions}
      onChange={(value) => (projectId = value)}
    />
    <Select
      size="sm"
      class="w-44"
      aria-label={t("activity.connection")}
      value={connectionId}
      options={connectionOptions}
      onChange={(value) => (connectionId = value)}
    />
    <form
      class="min-w-[180px] flex-1"
      onsubmit={(event) => {
        event.preventDefault();
        search = searchDraft.trim();
      }}
    >
      <input
        class={`${INPUT_SM_CLASS} w-full`}
        type="search"
        bind:value={searchDraft}
        onblur={() => (search = searchDraft.trim())}
        placeholder={t("activity.search")}
        aria-label={t("activity.search")}
      />
    </form>
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

  {#if actor}
    <p class="m-0 mb-2 flex items-center gap-2 text-xs" data-testid="activity-actor">
      <span>{t("activity.onlyActor", { name: actor.label })}</span>
      <Button size="xs" variant="ghost" onclick={() => (actor = null)}>{t("activity.allActors")}</Button>
    </p>
  {/if}
  {#if firstPage.error ?? more.error}<ErrorText>{firstPage.error ?? more.error}</ErrorText>{/if}

  {#if !firstPage.loading && entries.length === 0}
    <EmptyState>{t("activity.empty")}</EmptyState>
  {:else}
    <ul class="m-0 list-none divide-y divide-border/60 rounded-lg border border-border p-0" aria-label={t("activity.title")}>
      {#each entries as entry (entry.id)}
        {@const open = expanded === entry.id}
        <li data-testid="activity-entry">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2 text-left text-[12.5px] hover:bg-surface-hover"
            aria-expanded={open}
            onclick={() => (expanded = open ? null : entry.id)}
          >
            <span class="w-[130px] shrink-0 text-xs text-text-muted">
              {formatDateTime(parseServerTime(entry.createdAt), i18n.locale)}
            </span>
            <span class={`w-[96px] shrink-0 text-[10px] font-bold uppercase ${CATEGORY_TONE[entry.category]}`}>
              {t(`activity.category.${entry.category}`)}
            </span>
            <span class="w-[150px] shrink-0 truncate">{entry.actorName ?? entry.actorEmail ?? "—"}</span>
            <span class={`shrink-0 font-mono text-[11.5px] ${SEVERE.test(entry.action) ? "text-danger" : ""}`}>
              {entry.action}
            </span>
            <span class="min-w-0 flex-1 truncate text-text-secondary">
              {[entry.projectName, entry.connectionName, entry.detail].filter(Boolean).join(" · ")}
            </span>
            <Icon icon={ChevronRightIcon} size={12} class={`shrink-0 text-text-muted ${open ? "rotate-90" : ""}`} />
          </button>
          {#if open}
            <dl class="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1 bg-surface-raised px-4 py-3 text-xs">
              <dt class="text-text-muted">{t("activity.field.actor")}</dt>
              <dd class="m-0 flex flex-wrap items-center gap-2">
                <span>{[entry.actorName, entry.actorEmail].filter(Boolean).join(" — ") || "—"}</span>
                {#if entry.actorId && actor?.id !== entry.actorId}
                  {@const id = entry.actorId}
                  <Button
                    size="xs"
                    variant="ghost"
                    onclick={() => (actor = { id, label: entry.actorName ?? entry.actorEmail ?? id })}
                  >
                    {t("activity.showActor")}
                  </Button>
                {/if}
              </dd>
              <dt class="text-text-muted">{t("activity.field.action")}</dt>
              <dd class="m-0 font-mono">{entry.action}</dd>
              {#if entry.detail}
                <dt class="text-text-muted">{t("activity.field.detail")}</dt>
                <dd class="m-0 whitespace-pre-wrap break-words font-mono">{entry.detail}</dd>
              {/if}
              {#if entry.projectId}
                <dt class="text-text-muted">{t("activity.field.project")}</dt>
                <dd class="m-0">
                  {#if entry.projectName}
                    <a
                      class="text-primary hover:underline"
                      href={`/project/${entry.projectId}${entry.category === "deployments" ? "/deployments" : ""}`}
                    >
                      {entry.projectName}
                    </a>
                  {:else}
                    <span class="text-text-muted">{t("activity.deleted")}</span>
                  {/if}
                </dd>
              {/if}
              {#if entry.connectionId}
                <dt class="text-text-muted">{t("activity.field.connection")}</dt>
                <dd class="m-0">{entry.connectionName ?? t("activity.deleted")}</dd>
              {/if}
              {#if entry.targetType}
                <dt class="text-text-muted">{t("activity.field.target")}</dt>
                <dd class="m-0 font-mono">{entry.targetType}/{entry.targetId}</dd>
              {/if}
              <dt class="text-text-muted">{t("activity.field.ip")}</dt>
              <dd class="m-0 font-mono">{entry.ip ?? "—"}</dd>
              {#if entry.correlationId}
                <dt class="text-text-muted">{t("activity.field.correlation")}</dt>
                <dd class="m-0 font-mono">{entry.correlationId}</dd>
              {/if}
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

  <Hint>{t("activity.scopeNote")}</Hint>
</div>
