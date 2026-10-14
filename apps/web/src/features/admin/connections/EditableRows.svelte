<script lang="ts">
  import type { DatabaseEngine, DbAdminObjectRef, DbRowCell } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, PlusIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import DataGrid from "@/components/ui/DataGrid.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { applyRowEdits, fetchEditableRows, type ConnectionOverview } from "@/services/dbAdminApi";
  import { toCsv } from "@/features/sql/ResultGrid.svelte";
  import RowEditorModal from "./RowEditorModal.svelte";
  import StatementModal from "./StatementModal.svelte";
  import {
    NO_EDITS,
    addInsert,
    cellId,
    countEdits,
    displayedRows,
    removeInsert,
    setCell,
    setInsertCell,
    toOperations,
    toggleDelete,
    type PendingEdits,
  } from "./rowEdits";

  /**
   * A table's rows in the explorer, paged on the server, and — where the
   * server says the caller may — edited: changes are kept here as a pending
   * set (changed cells highlighted, added and deleted rows marked), then
   * reviewed as the very statements the server will run, and applied all at
   * once. A result of the SQL console has no row identity and never comes here.
   */
  let {
    connectionId,
    engine,
    overview,
    tableRef,
    fileName,
    onPendingChange,
  }: {
    connectionId: string;
    engine: DatabaseEngine;
    overview: ConnectionOverview;
    tableRef: DbAdminObjectRef;
    fileName: string;
    /** Told how many changes wait to be applied: the explorer asks before throwing them away. */
    onPendingChange?: (count: number) => void;
  } = $props();

  const PAGE_SIZE = 100;
  const { t } = useTranslation();
  let offset = $state(0);
  let edits = $state.raw<PendingEdits>(NO_EDITS);
  /** The row open in the editor: an index into the displayed rows, and the cell double-clicked. */
  let editing = $state.raw<{ index: number; column: string | null } | null>(null);
  let reviewing = $state(false);
  let discarding = $state(false);

  const page = useAsyncResource(() => fetchEditableRows(connectionId, tableRef, PAGE_SIZE, offset));
  const data = $derived(page.data);
  const rules = $derived(data?.editing ?? null);
  const editable = $derived(Boolean(rules?.editable));
  const partial = $derived(new Set((data?.partial ?? []).map(([row, column]) => cellId(row, column))));
  const counts = $derived(countEdits(edits));
  const shown = $derived(
    data && rules?.editable ? displayedRows(edits, rules, data.result.columns, data.result.rows, partial) : null,
  );
  $effect(() => {
    onPendingChange?.(counts.total);
  });

  function rowValues(index: number): Record<string, DbRowCell> {
    const columns = data!.result.columns;
    return Object.fromEntries(columns.map((name, c) => [name, shown!.rows[index][c]]));
  }

  function openRow(index: number, column: number | null) {
    const source = shown?.sources[index];
    if (!source) {
      toast.warning(t("dbadmin.rows.noIdentity"));
      return;
    }
    editing = { index, column: column === null ? null : data!.result.columns[column] };
  }

  const editor = $derived.by(() => {
    if (!editing || !shown || !data || !rules) return null;
    const source = shown.sources[editing.index];
    if (!source) return null;
    if ("insert" in source) {
      const insert = edits.inserts.find((x) => x.id === source.insert);
      if (!insert) return null;
      return { source, values: { ...insert.values } as Record<string, DbRowCell | undefined>, locked: new Set<string>() };
    }
    const locked = new Set(
      data.result.columns.filter((_, c) => partial.has(cellId(editing!.index, c))),
    );
    return { source, values: rowValues(editing.index), locked };
  });

  function saveRow(values: Record<string, DbRowCell | undefined>) {
    if (!editor || !data || !rules) return;
    const { source, locked } = editor;
    let next = edits;
    for (const column of rules.columns) {
      if (column.readOnly || locked.has(column.name)) continue;
      const value = values[column.name];
      if ("insert" in source) next = setInsertCell(next, source.insert, column.name, value);
      else if (value !== undefined) {
        const original = data.result.rows[editing!.index];
        next = setCell(next, rules, data.result.columns, original, source.identity, column.name, value);
      }
    }
    edits = next;
    editing = null;
  }

  function toggleRow() {
    if (!editor || !data || !rules) return;
    const { source } = editor;
    edits =
      "insert" in source
        ? removeInsert(edits, source.insert)
        : toggleDelete(edits, rules, data.result.columns, data.result.rows[editing!.index], source.identity);
    editing = null;
  }

  function addRow() {
    // The new row is displayed last: its index is the count before it is added.
    const index = shown!.rows.length;
    edits = addInsert(edits);
    editing = { index, column: null };
  }

  function exportCsv() {
    if (!data) return;
    // The BOM is what makes Excel read the file as UTF-8 instead of the system code page.
    const blob = new Blob(["﻿", toCsv(data.result.columns, data.result.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.replace(/[^\w.-]+/g, "_")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const operations = $derived(toOperations(edits));

  function afterApply() {
    const applied = counts.total;
    reviewing = false;
    edits = NO_EDITS;
    page.reload();
    toast.success(t("dbadmin.rows.applied", { count: applied }));
  }

  const pagingTooltip = $derived(counts.total > 0 ? t("dbadmin.rows.pagingBlocked") : undefined);
</script>

{#if page.error}<ErrorText>{page.error}</ErrorText>{/if}
{#if data && rules}
  <div class="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
    <span>
      {t("dbadmin.result.rows", { count: data.result.rowCount })} · {data.result.durationMs} ms
    </span>
    {#if editable}
      <Button variant="outline" size="xs" onclick={addRow} data-testid="rows-add">
        <Icon icon={PlusIcon} size={12} />
        {t("dbadmin.rows.addRow")}
      </Button>
    {:else if rules.reason && rules.reason !== "read-access"}
      <span class="text-text-secondary" data-testid="rows-read-only">{t(`dbadmin.rows.notEditable.${rules.reason}`)}</span>
    {/if}
    <div class="ml-auto flex items-center gap-2">
      {#if counts.total > 0}
        <span class="font-semibold text-warning" data-testid="rows-pending">{t("dbadmin.rows.pending", { count: counts.total })}</span>
        <Button variant="ghost" size="xs" onclick={() => (discarding = true)}>{t("dbadmin.rows.discard")}</Button>
        <Button variant="primary" size="xs" onclick={() => (reviewing = true)} data-testid="rows-review">
          {t("dbadmin.rows.review")}
        </Button>
      {/if}
      {#if data.result.columns.length > 0}
        <Button variant="ghost" size="xs" onclick={exportCsv}>
          <Icon icon={DownloadIcon} size={12} />
          {t("dbadmin.result.exportCsv")}
        </Button>
      {/if}
    </div>
  </div>

  {#if data.result.columns.length > 0}
    <!-- Keyed on the table and page: another page starts afresh, a pending change keeps the scroll position. -->
    {#if shown}
      <DataGrid
        columns={data.result.columns}
        rows={shown.rows}
        resultKey={data}
        rowTone={(index) => shown.tones[index]}
        cellChanged={(index, column) => shown.changed.has(cellId(index, column))}
        onRowOpen={openRow}
        rowOpenLabel={t("dbadmin.rows.editRow")}
        aria-label={t("dbadmin.result.gridLabel")}
        emptyLabel={t("dbadmin.result.empty")}
      />
    {:else}
      <DataGrid
        columns={data.result.columns}
        rows={data.result.rows}
        aria-label={t("dbadmin.result.gridLabel")}
        emptyLabel={t("dbadmin.result.empty")}
      />
    {/if}
  {/if}
  <div class="mt-2 flex items-center justify-end gap-2 text-xs text-text-muted">
    <span>{t("dbadmin.explorer.rowRange", { from: offset + 1, to: offset + data.result.rows.length })}</span>
    <Button
      variant="ghost"
      size="icon-xs"
      disabled={offset === 0 || page.loading || counts.total > 0}
      data-tooltip={pagingTooltip ?? t("dbadmin.explorer.previousPage")}
      onclick={() => (offset = Math.max(0, offset - PAGE_SIZE))}
    >
      <Icon icon={ChevronLeftIcon} size={13} />
    </Button>
    <Button
      variant="ghost"
      size="icon-xs"
      disabled={!data.result.truncated || page.loading || counts.total > 0}
      data-tooltip={pagingTooltip ?? t("dbadmin.explorer.nextPage")}
      onclick={() => (offset += PAGE_SIZE)}
    >
      <Icon icon={ChevronRightIcon} size={13} />
    </Button>
  </div>
{:else if page.loading}
  <EmptyState>{t("common.loading")}</EmptyState>
{/if}

{#if editing && editor && rules}
  {@const source = editor.source}
  <RowEditorModal
    {engine}
    columns={rules.columns}
    values={editor.values}
    locked={editor.locked}
    isNew={"insert" in source}
    deleted={"identity" in source && Boolean(edits.rows[source.identity]?.deleted)}
    focusColumn={editing.column}
    onSave={saveRow}
    onToggleDelete={toggleRow}
    onClose={() => {
      // An added row closed untouched is not a change anyone asked for.
      if ("insert" in source && Object.keys(edits.inserts.find((x) => x.id === source.insert)?.values ?? {}).length === 0) {
        edits = removeInsert(edits, source.insert);
      }
      editing = null;
    }}
  />
{/if}
{#if reviewing}
  <StatementModal
    title={t("dbadmin.rows.reviewTitle", { count: counts.total })}
    hint={`${t("dbadmin.rows.reviewHint")}${overview.access === "write" ? ` ${t("dbAccess.console.confirmWrite")}` : ""}`}
    danger
    run={(execute) => applyRowEdits(connectionId, tableRef, operations, execute)}
    onDone={afterApply}
    onClose={() => (reviewing = false)}
  />
{/if}
{#if discarding}
  <ConfirmDialog
    title={t("dbadmin.rows.discardTitle")}
    message={t("dbadmin.rows.discardMessage", { count: counts.total })}
    danger="warning"
    confirmLabel={t("dbadmin.rows.discard")}
    onCancel={() => (discarding = false)}
    onConfirm={() => {
      discarding = false;
      edits = NO_EDITS;
    }}
  />
{/if}

{#if editable}<Hint>{t("dbadmin.rows.gridHint")}</Hint>{/if}
