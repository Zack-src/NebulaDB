<script lang="ts" module>
  function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = typeof value === "string" ? value : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  export function toCsv(columns: string[], rows: unknown[][]): string {
    return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  }
</script>

<script lang="ts">
  import type { DbAdminQueryResult } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { DownloadIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /** A statement's rows, as returned — cells are already JSON-safe strings/numbers/booleans/null. */
  let { result, fileName = "result" }: { result: DbAdminQueryResult; fileName?: string } = $props();

  const { t } = useTranslation();
  /** The SQL keyword, shown as such in every language. */
  const NULL_LABEL = "NULL";

  function exportCsv() {
    // The BOM is what makes Excel read the file as UTF-8 instead of the system code page.
    const blob = new Blob(["﻿", toCsv(result.columns, result.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.replace(/[^\w.-]+/g, "_")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="flex items-center justify-between gap-2 pb-1.5 text-xs text-text-muted">
  <span>
    {#if result.columns.length === 0}
      {t("dbadmin.result.affected", { count: result.rowCount })}
    {:else}
      {t("dbadmin.result.rows", { count: result.rowCount })}{#if result.truncated}
        · <span class="text-warning">{t("dbadmin.result.truncated")}</span>{/if}
    {/if}
    · {result.durationMs} ms
  </span>
  {#if result.columns.length > 0}
    <Button variant="ghost" size="xs" onclick={exportCsv}>
      <Icon icon={DownloadIcon} size={12} />
      {t("dbadmin.result.exportCsv")}
    </Button>
  {/if}
</div>

{#if result.columns.length > 0}
  <div class="max-h-[420px] overflow-auto rounded-md border border-border">
    <table class="w-full border-collapse font-mono text-[12px]">
      <thead class="sticky top-0 bg-surface-raised">
        <tr>
          {#each result.columns as column, i (i)}
            <th class="border-b border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap text-text-secondary">
              {column}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each result.rows as row, r (r)}
          <tr class="border-b border-border/60 last:border-b-0 hover:bg-surface-hover">
            {#each row as cell, c (c)}
              <td class="max-w-[320px] truncate px-2 py-1 align-top whitespace-nowrap" title={cell === null ? "" : String(cell)}>
                {#if cell === null}<span class="text-text-muted italic">{NULL_LABEL}</span>{:else}{String(cell)}{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if result.rows.length === 0}
      <p class="px-3 py-4 text-center font-sans text-xs text-text-muted">{t("dbadmin.result.empty")}</p>
    {/if}
  </div>
{/if}
