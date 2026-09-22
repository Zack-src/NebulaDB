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
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import { SELECT_SM_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchErrorLog } from "@/services/errorsApi";

  /**
   * Read-only, same shape as `AuditTab` — the two are siblings on purpose:
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
</script>

<div>
  <div class="mb-3 flex items-center gap-3">
    <select class={SELECT_SM_CLASS} bind:value={source}>
      {#each SOURCE_FILTERS as filter (filter.value)}
        <option value={filter.value}>{t(filter.labelKey)}</option>
      {/each}
    </select>
    <span class="text-xs text-text-muted">
      {entries.loading ? t("common.loading") : t("admin.errors.entryCount", { count: rows.length })}
    </span>
  </div>

  {#if entries.error}<ErrorText>{entries.error}</ErrorText>{/if}

  {#if !entries.loading && rows.length === 0}
    <EmptyState>{t("admin.errors.empty")}</EmptyState>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full min-w-[720px] text-left text-[12.5px]">
        <thead class="bg-surface-raised/60 text-[11px] uppercase tracking-wide text-text-muted">
          <tr>
            <th class="px-3 py-2 font-semibold">{t("admin.errors.column.date")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.errors.column.source")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.errors.column.message")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.errors.column.user")}</th>
            <th class="px-3 py-2 font-semibold">{t("admin.errors.column.context")}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as entry (entry.id)}
            <tr
              class="cursor-pointer border-t border-border/60 hover:bg-surface-hover/60"
              onclick={() => (expandedId = expandedId === entry.id ? null : entry.id)}
            >
              <td class="whitespace-nowrap px-3 py-2 text-text-muted">{formatDateTime(entry.createdAt, i18n.locale)}</td>
              <td class="px-3 py-2">
                <Badge tone={entry.source === "server" ? "danger" : "warning"}>{entry.source}</Badge>
              </td>
              <td class="max-w-[320px] truncate px-3 py-2 font-mono text-[11.5px]">{entry.message}</td>
              <td class="px-3 py-2 text-text-secondary">{entry.userEmail ?? EMPTY_CELL}</td>
              <td class="max-w-[220px] truncate px-3 py-2 font-mono text-[11px] text-text-muted">
                {entry.context ?? EMPTY_CELL}
              </td>
            </tr>
            {#if expandedId === entry.id && entry.stack}
              <tr class="border-t border-border/60 bg-surface-raised/40">
                <td colspan={5} class="px-3 py-2">
                  <pre class="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-muted">{entry.stack}</pre>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <Hint>{t("admin.errors.scopeNote")}</Hint>
</div>
