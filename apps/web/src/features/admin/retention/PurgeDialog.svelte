<script lang="ts">
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime, formatNumber } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    fetchRetentionPreview,
    purgeRetention,
    type RetentionJournal,
    type RetentionPurgeResult,
  } from "@/services/retentionApi";

  /** "Purge now": shows what would go, and asks for the journal's key back before doing it. */
  let {
    journal,
    onDone,
    onCancel,
  }: {
    journal: RetentionJournal;
    onDone: (result: RetentionPurgeResult) => void;
    onCancel: () => void;
  } = $props();

  const { t } = useTranslation();
  const preview = useAsyncResource(() => fetchRetentionPreview(journal.key));
  const purge = useAsyncAction(async () => onDone(await purgeRetention(journal.key)));
</script>

<ConfirmDialog
  title={t("admin.retention.purge.title", { journal: journal.label })}
  message={t("admin.retention.purge.message")}
  confirmLabel={t("admin.retention.purge.confirm")}
  danger="danger"
  requireText={journal.key}
  pending={purge.pending}
  error={purge.error}
  onConfirm={() => void purge.run()}
  {onCancel}
>
  <p class="m-0 text-body font-semibold" role="status" data-testid="retention-preview">
    {#if preview.error}
      {preview.error}
    {:else if !preview.data}
      {t("common.loading")}
    {:else if preview.data.rows === 0}
      {t("admin.retention.purge.nothing")}
    {:else}
      {t("admin.retention.purge.preview", { count: preview.data.rows, rows: formatNumber(preview.data.rows, i18n.locale) })}
      {#if preview.data.cutoff}
        <span class="font-normal text-text-muted">
          {t("admin.retention.purge.cutoff", { date: formatDateTime(preview.data.cutoff, i18n.locale) })}
        </span>
      {/if}
    {/if}
  </p>
</ConfirmDialog>
