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
  import type { DbAdminQueryResult } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { DownloadIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import DataGrid from "@/components/ui/DataGrid.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /** A statement's rows, as returned — cells are already JSON-safe strings/numbers/booleans/null. */
  let { result, fileName = "result" }: { result: DbAdminQueryResult; fileName?: string } = $props();

  const { t } = useTranslation();
  const columnsKey = $derived(JSON.stringify(result.columns));

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
  <!-- Keyed on the columns: another page of the same table keeps its sort and widths, another result starts afresh. -->
  {#key columnsKey}
    <DataGrid
      columns={result.columns}
      rows={result.rows}
      aria-label={t("dbadmin.result.gridLabel")}
      emptyLabel={t("dbadmin.result.empty")}
    />
  {/key}
{/if}
