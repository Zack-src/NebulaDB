<script lang="ts">
  import Table from "@/components/ui/Table.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime, formatNumber } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchRetention, type RetentionJournal, type RetentionPurgeResult } from "@/services/retentionApi";
  import PurgeDialog from "./PurgeDialog.svelte";
  import RetentionRow from "./RetentionRow.svelte";

  /**
   * How long each journal is kept, and a purge on demand. The server purges hourly on its own; this
   * only changes the duration (an administrator's setting wins over the environment, which wins over
   * the default) and runs the purge early. Siblings: the audit log and error log tabs it manages.
   */
  const { t } = useTranslation();
  const journals = useAsyncResource(fetchRetention);
  let purging = $state<RetentionJournal | null>(null);
  let result = $state<{ label: string; purge: RetentionPurgeResult } | null>(null);
  // A saved row replaces its journal without refetching the whole list.
  let edited = $state<Record<string, RetentionJournal>>({});

  const rows = $derived((journals.data ?? []).map((journal) => edited[journal.key] ?? journal));
  const columns = $derived([
    { label: t("admin.retention.column.journal") },
    { label: t("admin.retention.column.duration") },
    { label: t("admin.retention.column.volume") },
    { label: t("admin.retention.column.lastPurge") },
  ]);

  function purged(purge: RetentionPurgeResult) {
    result = { label: purging?.label ?? purge.key, purge };
    purging = null;
    edited = {};
    journals.reload();
  }
</script>

<div>
  <p class="mb-3 text-body-sm leading-normal text-text-muted">{t("admin.retention.intro")}</p>

  {#if journals.error}<ErrorText>{journals.error}</ErrorText>{/if}

  {#if result}
    <p
      class="mb-3 rounded-md border border-success/35 bg-success-light px-2.5 py-2 text-body-sm text-success"
      role="status"
      data-testid="retention-result"
    >
      {t("admin.retention.purge.done", {
        journal: result.label,
        count: result.purge.deleted,
        rows: formatNumber(result.purge.deleted, i18n.locale),
        date: formatDateTime(result.purge.at, i18n.locale),
      })}
    </p>
  {/if}

  {#if journals.loading && !journals.data}
    <p class="text-label text-text-muted">{t("common.loading")}</p>
  {:else}
    <Table label={t("admin.section.retention")} {columns} minWidth={820}>
      {#each rows as journal (journal.key)}
        <RetentionRow
          {journal}
          onChange={(next) => (edited = { ...edited, [next.key]: next })}
          onPurge={(target) => (purging = target)}
        />
      {/each}
    </Table>
  {/if}

  <Hint>{t("admin.retention.scopeNote")}</Hint>
</div>

{#if purging}
  <PurgeDialog journal={purging} onDone={purged} onCancel={() => (purging = null)} />
{/if}
