<script lang="ts" module>
  import type { HistoryMarker } from "@nebuladb/shared";
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import { LockIcon, LockOpenIcon, RestoreIcon, SparklesIcon, UndoIcon } from "@/components/icons/Icons";

  const MARKER_ICON: Record<HistoryMarker["kind"], IconDefinition> = {
    lock: LockIcon,
    unlock: LockOpenIcon,
    restore: RestoreIcon,
    deployment: SparklesIcon,
    rollback: UndoIcon,
  };
  const STATUS_SIGN = { added: "+", removed: "−", changed: "~" } as const;
  const STATUS_CLASS = { added: "text-success", removed: "text-danger", changed: "text-warning" } as const;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { Project } from "@nebuladb/shared";
  import { diffProjects, type ProjectDiff } from "@nebuladb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, EyeIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { INPUT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { toast } from "@/components/ui/toast.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    exportRevisionDbml,
    fetchHistoryMarkers,
    fetchRevisionProject,
    fetchRevisions,
    labelRevision,
    restoreRevision,
    type RevisionSummary,
  } from "@/services/projectsApi";
  import DiffSummary from "./DiffSummary.svelte";
  import { buildTimeline, type RevisionEntry } from "./timeline";

  /**
   * The workspace's "Historique" tab: the project's timeline, newest first.
   *
   * Revisions close together by one person read as one line (`timeline.ts`),
   * expandable into their steps; locks, restores and — for administrators —
   * deployments sit among them. Picking a revision shows what changed since
   * (`diffProjects` — safe client-side, no `@dbml/core` in it) and its DBML,
   * and offers to preview that difference on the diagram, to restore the
   * whole revision, or only one table of it. A restore is a new revision,
   * never a rewrite of the history; a locked table refuses it server-side.
   */
  let {
    projectId,
    currentProject,
    currentUser,
    initialRevisionId = null,
    onClose,
    onPreview,
    canRestore = true,
  }: {
    projectId: string;
    currentProject: Project;
    /** The display name revisions are recorded under — "Mes modifications" filters on it. */
    currentUser: string;
    /** The revision to open on — the one last previewed — instead of the newest. */
    initialRevisionId?: string | null;
    /** Called once a whole revision has been restored — the workspace goes back to the schema to show the result. */
    onClose: () => void;
    /** Shows the difference with this revision on the diagram (the workspace switches to the schema tab). */
    onPreview: (revision: RevisionSummary, project: Project) => void;
    /** False for a view-only grant: the timeline and previews stay, labelling and restoring go. */
    canRestore?: boolean;
  } = $props();

  const { t } = useTranslation();
  let revisions = $state.raw<RevisionSummary[]>([]);
  let markers = $state.raw<HistoryMarker[]>([]);
  let onlyMine = $state(false);
  let expanded = $state.raw<ReadonlySet<string>>(new Set());
  let selectedId = $state<string | null>(untrack(() => initialRevisionId));
  let preview = $state("");
  let revisionProject = $state.raw<Project | null>(null);
  let diff = $state.raw<ProjectDiff | null>(null);
  let loadingPreview = $state(false);
  let error = $state<string | null>(null);
  let labelInput: HTMLInputElement | undefined = $state();
  /** Bumped to re-read the selected revision against the current schema after a partial restore. */
  let comparedAt = $state(0);

  async function load() {
    const [loadedRevisions, loadedMarkers] = await Promise.all([
      fetchRevisions(projectId),
      // The timeline is still useful without its markers.
      fetchHistoryMarkers(projectId).catch(() => []),
    ]);
    revisions = loadedRevisions;
    markers = loadedMarkers;
  }

  $effect(() => {
    void projectId;
    load()
      .then(() => {
        if (!selectedId && revisions.length > 0) selectedId = revisions[revisions.length - 1].id;
      })
      .catch((err: unknown) => (error = describeApiError(err, t)));
  });

  const timeline = $derived(
    buildTimeline(
      onlyMine ? revisions.filter((revision) => revision.author === currentUser) : revisions,
      onlyMine ? markers.filter((marker) => marker.actor === currentUser) : markers,
    ),
  );
  const selected = $derived(revisions.find((revision) => revision.id === selectedId) ?? null);

  $effect(() => {
    const id = selectedId;
    const pid = projectId;
    void comparedAt;
    if (!id) return;
    loadingPreview = true;
    Promise.all([exportRevisionDbml(pid, id), fetchRevisionProject(pid, id)])
      .then(([dbml, loaded]) => {
        preview = dbml;
        revisionProject = loaded;
        // `currentProject` deliberately untracked: it's a new object on every
        // doc change, and re-diffing on every remote edit while the panel is
        // open would be noisy — the comparison point is "this revision vs.
        // what was on screen when I picked it". The diagram preview is live.
        diff = diffProjects(loaded, untrack(() => currentProject));
      })
      .catch((err: unknown) => (error = describeApiError(err, t)))
      .finally(() => (loadingPreview = false));
  });

  const when = (value: string) => formatDateTime(parseServerTime(value), i18n.locale);

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function markerText(marker: HistoryMarker): string {
    switch (marker.kind) {
      case "lock":
        return t("history.marker.lock", { detail: marker.detail });
      case "unlock":
        return t("history.marker.unlock", { detail: marker.detail });
      case "restore": {
        const date = marker.revisionAt ? when(marker.revisionAt) : null;
        if (marker.detail) return t("history.marker.restoreTables", { tables: marker.detail, date: date ?? "?" });
        return date ? t("history.marker.restore", { date }) : t("history.marker.restoreUnknown");
      }
      case "deployment":
        return t(marker.success ? "history.marker.deployment" : "history.marker.deploymentFailed", {
          connection: marker.environment ? `${marker.detail} (${marker.environment})` : marker.detail,
        });
      case "rollback":
        return t("history.marker.rollback", { connection: marker.detail });
    }
  }

  const saveLabel = useAsyncAction(async () => {
    if (!selectedId || !labelInput) return;
    const id = selectedId;
    const label = labelInput.value.trim() || null;
    await labelRevision(projectId, id, label);
    revisions = revisions.map((rev) => (rev.id === id ? { ...rev, label } : rev));
  });

  const restore = useAsyncAction(async () => {
    if (!selectedId) return;
    await restoreRevision(projectId, selectedId);
    onClose();
  });

  // Stays on the page: one table back is a step, the user may want another.
  let restoringTableId = $state<string | null>(null);
  const restoreTable = useAsyncAction(async (tableId: string, tableName: string) => {
    if (!selectedId || !selected) return;
    restoringTableId = tableId;
    try {
      await restoreRevision(projectId, selectedId, [tableId]);
      toast.success(t("history.tableRestored", { table: tableName, date: when(selected.createdAt) }));
      await load();
      // The comparison point moved: the table now matches the revision.
      comparedAt += 1;
    } finally {
      restoringTableId = null;
    }
  });

  const loadingLabel = $derived(t("common.loading"));
  const shownError = $derived(error ?? saveLabel.error ?? restore.error ?? restoreTable.error);
  const busy = $derived(restore.pending || restoreTable.pending);
</script>

{#snippet tableSummary(entry: Pick<RevisionEntry, "tables" | "moreTables" | "refs">)}
  {#if entry.tables.length > 0 || entry.refs > 0}
    <div class="mt-px flex gap-x-1.5 overflow-hidden whitespace-nowrap font-mono text-caption">
      {#each entry.tables as table, index (index)}
        <span class={STATUS_CLASS[table.status]}>{STATUS_SIGN[table.status]}{table.name}</span>
      {/each}
      {#if entry.moreTables > 0}<span class="text-text-muted">+{entry.moreTables}</span>{/if}
      {#if entry.refs > 0}<span class="text-text-muted">{t("history.refs", { count: entry.refs })}</span>{/if}
    </div>
  {/if}
{/snippet}

<!-- A page of the workspace (the "Historique" tab), not a dialog: it fills the space under the tab bar. -->
<div class="flex min-h-0 flex-1 flex-col bg-bg">
  <div class="flex min-h-0 flex-1">
    <div class="flex w-[300px] shrink-0 flex-col border-r border-border">
      <div class="flex items-center border-b border-border px-3 py-2">
        <Checkbox bind:checked={onlyMine}>{t("history.onlyMine")}</Checkbox>
      </div>
      <ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1.5" aria-label={t("history.title")}>
        <li class="mb-0.5 flex items-center gap-2 px-[9px] py-1.5 text-caption text-text-muted">
          <span class="h-2 w-2 shrink-0 rounded-full bg-primary"></span>
          <span class="font-semibold text-text">{t("history.now")}</span>
          {t("history.currentState")}
        </li>
        {#each timeline as entry (entry.id)}
          {#if entry.kind === "marker"}
            <li
              class="mb-0.5 flex items-start gap-2 px-[9px] py-1 text-caption text-text-muted"
              data-testid="history-marker"
              data-kind={entry.marker.kind}
            >
              <Icon
                icon={MARKER_ICON[entry.marker.kind]}
                size={12}
                class={`mt-px shrink-0 ${entry.marker.success === false ? "text-danger" : ""}`}
              />
              <span class="min-w-0 flex-1">
                <span class="text-text-secondary">{markerText(entry.marker)}</span>
                <span class="block">{[entry.marker.actor, when(entry.marker.at)].filter(Boolean).join(" · ")}</span>
              </span>
            </li>
          {:else}
            {@const isOpen = expanded.has(entry.id)}
            {@const steps = entry.revisions.length}
            <li data-testid="history-entry">
              <div
                class={`mb-0.5 flex items-stretch rounded-sm transition-colors duration-fast hover:bg-surface-hover ${
                  entry.id === selectedId ? "!bg-primary-light" : ""
                }`}
              >
                <button
                  type="button"
                  class="min-w-0 flex-1 cursor-pointer border-0 bg-transparent px-[9px] py-2 text-left"
                  aria-current={entry.id === selectedId ? "true" : undefined}
                  onclick={() => (selectedId = entry.id)}
                >
                  <div class="flex items-center gap-1 truncate text-[12.5px] font-semibold text-text">
                    {entry.label ? `🏷 ${entry.label}` : entry.author === currentUser ? t("history.you") : entry.author}
                  </div>
                  <div class="mt-px text-caption text-text-muted">
                    {[
                      entry.label ? entry.author : null,
                      when(entry.createdAt),
                      steps > 1 ? t("history.steps", { count: steps }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {@render tableSummary(entry)}
                </button>
                {#if steps > 1}
                  <button
                    type="button"
                    class="flex w-7 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-text-muted hover:text-text"
                    aria-expanded={isOpen}
                    aria-label={t(isOpen ? "history.hideSteps" : "history.showSteps", { count: steps })}
                    data-tooltip={t(isOpen ? "history.hideSteps" : "history.showSteps", { count: steps })}
                    onclick={() => toggleExpanded(entry.id)}
                  >
                    <Icon icon={ChevronRightIcon} size={13} class={`transition-transform duration-fast ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                {/if}
              </div>
              {#if isOpen}
                <ul class="m-0 mb-1 ml-3 list-none border-l border-border p-0 pl-1.5">
                  {#each [...entry.revisions].reverse() as step (step.id)}
                    <li>
                      <button
                        type="button"
                        class={`block w-full cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1 text-left hover:bg-surface-hover ${
                          step.id === selectedId ? "!bg-primary-light" : ""
                        }`}
                        onclick={() => (selectedId = step.id)}
                      >
                        <div class="text-caption text-text-muted">{when(step.createdAt)}</div>
                        {#if step.changes}{@render tableSummary(step.changes)}{/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/if}
        {/each}
        {#if timeline.length === 0}
          <li class="p-2 text-xs text-text-muted">{onlyMine ? t("history.emptyMine") : t("history.empty")}</li>
        {/if}
      </ul>
    </div>
    <div class="flex min-w-0 flex-1 flex-col px-3.5 py-3">
      <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-[220px] flex-1 gap-1.5">
          {#key selectedId}
            <input
              bind:this={labelInput}
              class={`${INPUT_CLASS} flex-1`}
              value={untrack(() => revisions.find((revision) => revision.id === selectedId)?.label ?? "")}
              placeholder={t("history.labelPlaceholder")}
              disabled={!selectedId || !canRestore}
            />
          {/key}
          {#if canRestore}
            <Button size="sm" onclick={() => void saveLabel.run()} disabled={!selectedId || saveLabel.pending}>
              {saveLabel.pending ? t("common.saving") : t("history.label")}
            </Button>
          {/if}
        </div>
        <div class="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onclick={() => selected && revisionProject && onPreview(selected, revisionProject)}
            disabled={!selected || !revisionProject || loadingPreview}
          >
            <Icon icon={EyeIcon} size={13} />
            {t("history.previewOnDiagram")}
          </Button>
          {#if canRestore}
            <Button variant="primary" size="sm" onclick={() => void restore.run()} disabled={!selectedId || busy}>
              {restore.pending ? t("history.restoring") : t("history.restore")}
            </Button>
          {/if}
        </div>
      </div>
      <div
        class="mb-2.5 max-h-[160px] overflow-y-auto rounded-sm border border-border bg-[var(--color-bg-canvas)] px-2.5 py-2"
      >
        <div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
          {t("history.changesSince")}
        </div>
        {#if loadingPreview}
          <div class="text-xs text-text-muted">{loadingLabel}</div>
        {:else if diff}
          <DiffSummary
            {diff}
            disabled={busy}
            onRestoreTable={canRestore
              ? (tableId, tableName) => {
                  if (restoringTableId === null) void restoreTable.run(tableId, tableName);
                }
              : undefined}
          />
        {/if}
      </div>
      <textarea readonly class={`${TEXTAREA_CODE_CLASS} flex-1`} value={loadingPreview ? loadingLabel : preview}></textarea>
    </div>
  </div>
  {#if shownError}<div class="px-3.5 pb-3"><ErrorText>{shownError}</ErrorText></div>{/if}
</div>
