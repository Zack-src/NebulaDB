<script lang="ts">
  import type { ProjectDiff } from "@nebuladb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { EyeIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { restoreRevision, type RevisionSummary } from "@/services/projectsApi";

  /**
   * "Aperçu" of a revision on the diagram: a strip above the canvas while the
   * tables added (green) or changed (orange) since that revision are outlined
   * on it — `CanvasNodesState`'s `historyDiff`. Tables deleted since are not on
   * the canvas to outline, so the strip names them, each with its own restore.
   * The diff is live: editing during the preview updates it.
   */
  let {
    projectId,
    revision,
    diff,
    canRestore,
    onBack,
    onClose,
  }: {
    projectId: string;
    revision: RevisionSummary;
    /** Revision → current schema, recomputed on every change. */
    diff: ProjectDiff;
    canRestore: boolean;
    /** Back to the history tab, on the same revision. */
    onBack: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  const date = $derived(formatDateTime(parseServerTime(revision.createdAt), i18n.locale));
  const added = $derived(diff.tables.filter((table) => table.status === "added").length);
  const changed = $derived(diff.tables.filter((table) => table.status === "changed").length);
  const removed = $derived(diff.tables.filter((table) => table.status === "removed"));
  const counts = $derived(
    [
      added > 0 ? t("historyPreview.added", { count: added }) : null,
      changed > 0 ? t("historyPreview.changed", { count: changed }) : null,
      diff.refs.length > 0 ? t("history.refs", { count: diff.refs.length }) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const restoreAll = useAsyncAction(async () => {
    await restoreRevision(projectId, revision.id);
    toast.success(t("historyPreview.restored", { date }));
    onClose();
  });
  const restoreOne = useAsyncAction(async (tableId: string, tableName: string) => {
    await restoreRevision(projectId, revision.id, [tableId]);
    toast.success(t("history.tableRestored", { table: tableName, date }));
  });
  const busy = $derived(restoreAll.pending || restoreOne.pending);
</script>

<div
  role="status"
  data-testid="history-preview"
  class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-primary/40 bg-primary-light px-4 py-2 text-body-sm text-text"
>
  <Icon icon={EyeIcon} size={15} class="shrink-0 text-primary" />
  <span class="min-w-0 flex-1">
    <span class="font-semibold">{t("historyPreview.banner", { date, author: revision.author ?? "?" })}</span>
    <span class="text-text-secondary">
      {#if diff.tables.length === 0 && diff.refs.length === 0}
        {t("history.noChanges")}
      {:else}
        {counts}
      {/if}
    </span>
    {#if removed.length > 0}
      <span class="mt-1 flex flex-wrap items-center gap-1.5">
        <span class="text-danger">{t("historyPreview.removedSince")}</span>
        {#each removed as table (table.id)}
          <span class="inline-flex items-center gap-1 rounded-xs border border-danger/40 px-1.5 font-mono text-caption">
            {table.name}
            {#if canRestore}
              <button
                type="button"
                class="cursor-pointer border-0 bg-transparent p-0 text-caption text-primary underline-offset-2 hover:underline disabled:opacity-50"
                disabled={busy}
                onclick={() => void restoreOne.run(table.id, table.name)}
              >
                {t("historyPreview.bringBack")}
              </button>
            {/if}
          </span>
        {/each}
      </span>
    {/if}
  </span>
  <Button size="xs" variant="ghost" onclick={onBack} disabled={busy}>{t("historyPreview.back")}</Button>
  {#if canRestore}
    <Button size="xs" variant="outline" onclick={() => void restoreAll.run()} disabled={busy}>
      {restoreAll.pending ? t("history.restoring") : t("history.restore")}
    </Button>
  {/if}
  <Button size="xs" variant="ghost" onclick={onClose} disabled={busy}>{t("historyPreview.close")}</Button>
  {#if restoreAll.error ?? restoreOne.error}
    <span class="w-full text-danger">{restoreAll.error ?? restoreOne.error}</span>
  {/if}
</div>
