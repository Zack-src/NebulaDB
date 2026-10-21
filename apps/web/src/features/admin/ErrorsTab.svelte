<script lang="ts" module>
  import type { TranslationKeyOf } from "@/types";

  const SOURCE_FILTERS: { value: "" | "server" | "client"; labelKey: TranslationKeyOf }[] = [
    { value: "", labelKey: "admin.errors.filter.all" },
    { value: "server", labelKey: "admin.errors.filter.server" },
    { value: "client", labelKey: "admin.errors.filter.client" },
  ];

  const EMPTY_CELL = "—";
</script>

<script lang="ts">
  import Table, { TABLE_CELL, TABLE_ROW } from "@/components/ui/Table.svelte";
  import PageToolbar from "@/components/layout/PageToolbar.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchErrorLog } from "@/services/errorsApi";

  /**
   * Read-only, same shape as `ActivityTab` — the two are siblings on purpose:
   * where the audit log answers "what did someone do", this answers "what
   * broke", server-side unhandled throws and client-side render crashes both.
   * See `errorLog.ts` on the server for why this exists and what it doesn't
   * try to be (not tamper-evident, not a compliance trail — a debugging aid).
   */
  const { t } = useTranslation();
  let source = $state<"" | "server" | "client">("");
  let expandedId = $state<string | null>(null);
  const entries = useAsyncResource(() => fetchErrorLog(source ? { source } : {}));

  const rows = $derived(entries.data ?? []);
  const columns = $derived([
    { label: t("admin.errors.column.date") },
    { label: t("admin.errors.column.source") },
    { label: t("admin.errors.column.message") },
    { label: t("admin.errors.column.user") },
    { label: t("admin.errors.column.context") },
  ]);
</script>

<div>
  <PageToolbar>
    <Select
      size="sm"
      class="w-44"
      bind:value={source}
      options={SOURCE_FILTERS.map((filter) => ({ value: filter.value, label: t(filter.labelKey) }))}
      aria-label={t("admin.errors.column.source")}
    />
    <span class="text-label text-text-muted">
      {entries.loading ? t("common.loading") : t("admin.errors.entryCount", { count: rows.length })}
    </span>
  </PageToolbar>

  {#if entries.error}<ErrorText>{entries.error}</ErrorText>{/if}

  {#if !entries.loading && rows.length === 0}
    <EmptyState>{t("admin.errors.empty")}</EmptyState>
  {:else}
    <Table label={t("admin.section.errors")} columns={columns} minWidth={720}>
          {#each rows as entry (entry.id)}
            <tr
              class={`${TABLE_ROW} cursor-pointer hover:bg-surface-hover/60`}
              onclick={() => (expandedId = expandedId === entry.id ? null : entry.id)}
            >
              <td class={`${TABLE_CELL.comfortable} whitespace-nowrap text-text-muted`}>{formatDateTime(entry.createdAt, i18n.locale)}</td>
              <td class={TABLE_CELL.comfortable}>
                <Badge tone={entry.source === "server" ? "danger" : "warning"}>{entry.source}</Badge>
              </td>
              <td class={`${TABLE_CELL.comfortable} max-w-[320px] truncate font-mono text-caption`}>{entry.message}</td>
              <td class={`${TABLE_CELL.comfortable} text-text-secondary`}>{entry.userEmail ?? EMPTY_CELL}</td>
              <td class={`${TABLE_CELL.comfortable} max-w-[220px] truncate font-mono text-caption text-text-muted`}>
                {entry.context ?? EMPTY_CELL}
              </td>
            </tr>
            {#if expandedId === entry.id && entry.stack}
              <tr class={`${TABLE_ROW} bg-surface-raised/40`}>
                <td colspan={5} class={TABLE_CELL.comfortable}>
                  <pre class="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-caption text-text-muted">{entry.stack}</pre>
                </td>
              </tr>
            {/if}
          {/each}
    </Table>
  {/if}

  <Hint>{t("admin.errors.scopeNote")}</Hint>
</div>
