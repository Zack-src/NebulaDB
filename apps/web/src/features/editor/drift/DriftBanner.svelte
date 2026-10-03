<script lang="ts">
  import type { DriftCheckResult, ProjectDriftEntry } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { checkProjectDrift, dismissProjectDrift, pullDatabaseSchema } from "@/services/connectionsApi";

  /**
   * "This database was changed outside the schema" — one strip per linked
   * database carrying the mark, between the toolbar and the canvas.
   *
   * Everyone who can open the project sees it: someone about to edit a table
   * should know the database no longer matches. What can be *done* about it —
   * look at the differences, bring the schema to the database, wave it off —
   * is for the project's administrators, like every other action that reaches
   * a database. For them the strip also counts the differences, which means
   * reading the database once; nobody else's visit opens a connection.
   */
  let {
    projectId,
    entry,
    canManage,
    onShowDifferences,
  }: {
    projectId: string;
    entry: ProjectDriftEntry;
    canManage: boolean;
    onShowDifferences: (connectionId: string) => void;
  } = $props();

  const { t } = useTranslation();
  let check = $state.raw<DriftCheckResult | null>(null);
  let confirmingPull = $state(false);

  // Once per mark: a new out-of-schema change is a new `outOfSchemaAt`.
  $effect(() => {
    void entry.outOfSchemaAt;
    if (!canManage) return;
    let active = true;
    check = null;
    checkProjectDrift(projectId, entry.connectionId)
      .then((result) => {
        if (active) check = result;
      })
      // Unreachable database, or rate-limited: the strip still says what it knows.
      .catch(() => {});
    return () => {
      active = false;
    };
  });

  /** "il y a 3 minutes · 2 différences avec le schéma" — whichever parts are known. */
  const detail = $derived(
    [
      entry.outOfSchemaAt ? formatRelativeTime(parseServerTime(entry.outOfSchemaAt), i18n.locale) : null,
      check ? t("drift.differences", { count: check.againstSchema.tables + check.againstSchema.refs }) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  // No `onDone`: the server announces `drift-changed`, and the strip goes when the mark does.
  const pull = useAsyncAction(async () => {
    const result = await pullDatabaseSchema(projectId, entry.connectionId);
    toast.success(t("connections.pulledSuccess", { count: result.tablesCount }));
  });
  const dismiss = useAsyncAction(() => dismissProjectDrift(projectId, entry.connectionId));
  const busy = $derived(pull.pending || dismiss.pending);
</script>

<div
  role="status"
  class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning-border bg-warning-light px-4 py-2 text-body-sm text-text"
>
  <Icon icon={AlertTriangleIcon} size={15} class="shrink-0 text-warning" />
  <span class="min-w-0 flex-1">
    <span class="font-semibold">{t("drift.banner", { connection: entry.connectionName })}</span>
    {#if detail}<span class="text-text-secondary">{detail}</span>{/if}
  </span>
  {#if canManage}
    <Button size="xs" variant="outline" onclick={() => onShowDifferences(entry.connectionId)} disabled={busy}>
      {t("drift.show")}
    </Button>
    <Button size="xs" variant="outline" onclick={() => (confirmingPull = true)} disabled={busy}>
      {pull.pending ? t("common.loading") : t("drift.resync")}
    </Button>
    <Button size="xs" variant="ghost" onclick={() => void dismiss.run()} disabled={busy}>{t("drift.dismiss")}</Button>
  {/if}
  {#if pull.error ?? dismiss.error}
    <span class="w-full text-danger">{pull.error ?? dismiss.error}</span>
  {/if}
</div>

{#if confirmingPull}
  <ConfirmDialog
    title={t("drift.resyncTitle")}
    message={t("drift.resyncMessage", { connection: entry.connectionName })}
    danger="warning"
    confirmLabel={t("drift.resync")}
    onCancel={() => (confirmingPull = false)}
    onConfirm={() => {
      confirmingPull = false;
      void pull.run();
    }}
  />
{/if}
