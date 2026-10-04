<script lang="ts">
  import type {
    DbAdminObjectRef,
    DbAdminStatementsResult,
    DbAdminTable,
    StructurePolicyRefusal,
  } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import {
    ChevronLeftIcon,
    ChevronRightIcon,
    FileSpreadsheetIcon,
    KeyIcon,
    TableIcon,
    TrashIcon,
  } from "@/components/icons/Icons";
  import { toast } from "@/components/ui/toast.svelte";
  import { useWorkspace } from "@/features/workspace/workspaceContext";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import Select from "@/components/ui/Select.svelte";
  import Tabs from "@/components/ui/Tabs.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatNumber } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    dropObject,
    fetchSchemas,
    fetchTableDescription,
    fetchTableRows,
    fetchTables,
    type ConnectionOverview,
    type DropKind,
  } from "@/services/dbAdminApi";
  import { formatBytes } from "@/features/sql/format";
  import ResultGrid from "@/features/sql/ResultGrid.svelte";
  import StatementModal from "./StatementModal.svelte";
  import StructureRedirectDialog from "@/features/sql/StructureRedirectDialog.svelte";

  /**
   * Database → schema → table browser. The left column narrows down to a table;
   * the right shows its rows (paged on the server) or its structure. Every
   * destructive button goes through `StatementModal`: SQL preview, then the
   * object's name typed back.
   */
  let {
    connectionId,
    overview,
    database = $bindable(),
    onDatabaseDropped,
  }: {
    connectionId: string;
    overview: ConnectionOverview;
    database: string;
    onDatabaseDropped: () => void;
  } = $props();

  const PAGE_SIZE = 100;
  // SQL keywords, shown as such in every language.
  const PRIMARY_LABEL = "PK";
  const UNIQUE_LABEL = "UNIQUE";
  const { t } = useTranslation();
  const capabilities = $derived(overview.capabilities);
  const currentDatabase = $derived(overview.databases.find((d) => d.name === database) ?? null);
  const databaseArg = $derived(capabilities.multiDatabase ? database || undefined : undefined);

  let schema = $state("");
  let filter = $state("");
  // Inside a project's workspace the explorer knows which schema it is looking at the database of.
  const workspace = useWorkspace();
  let selected = $state.raw<DbAdminTable | null>(null);
  let view = $state<"data" | "structure">("data");
  let offset = $state(0);
  let drop = $state.raw<{ kind: DropKind; ref: DbAdminObjectRef; name: string } | null>(null);
  let redirect = $state.raw<StructurePolicyRefusal | null>(null);

  // Tables and columns are what a project models; a view or a whole database
  // is not. The server applies the same rule — this only saves asking it for a
  // preview it would refuse.
  const policy = $derived(overview.structurePolicy);
  const policyApplies = (kind: DropKind) => (kind === "table" || kind === "column") && policy.projects.length > 0;

  function requestDrop(next: { kind: DropKind; ref: DbAdminObjectRef; name: string }) {
    if (policyApplies(next.kind) && policy.policy === "schema-only") {
      redirect = {
        policy: policy.policy,
        projects: policy.projects,
        actions: [
          next.kind === "column"
            ? { verb: "alter", kind: "table", object: next.ref.table ?? null, column: next.ref.column }
            : { verb: "drop", kind: "table", object: next.ref.table ?? null },
        ],
      };
      return;
    }
    drop = next;
  }

  const schemas = useAsyncResource(() => (capabilities.schemas ? fetchSchemas(connectionId, databaseArg) : Promise.resolve([])));
  // Opening a database lands on its first non-system schema rather than on "all schemas" of a server with hundreds of tables.
  $effect(() => {
    const list = schemas.data ?? [];
    if (list.length > 0 && !list.some((s) => s.name === schema)) {
      schema = (list.find((s) => ["public", "dbo"].includes(s.name)) ?? list.find((s) => !s.system) ?? list[0]).name;
    }
  });

  const tables = useAsyncResource(() => {
    if (capabilities.schemas && !schema) return Promise.resolve([]);
    return fetchTables(connectionId, databaseArg, capabilities.schemas ? schema : undefined);
  });
  const visibleTables = $derived(
    (tables.data ?? []).filter((table) => table.name.toLowerCase().includes(filter.trim().toLowerCase())),
  );
  // The selection only makes sense inside the list it was picked from.
  $effect(() => {
    const list = tables.data;
    if (selected && list && !list.some((x) => x.name === selected?.name && x.schema === selected?.schema)) selected = null;
  });

  const ref = $derived<DbAdminObjectRef | null>(
    selected ? { database: databaseArg, schema: selected.schema ?? undefined, table: selected.name } : null,
  );
  const rows = useAsyncResource(() => (ref && view === "data" ? fetchTableRows(connectionId, ref, PAGE_SIZE, offset) : Promise.resolve(null)));
  const description = useAsyncResource(() => (ref && view === "structure" ? fetchTableDescription(connectionId, ref) : Promise.resolve(null)));

  function select(table: DbAdminTable) {
    selected = table;
    offset = 0;
  }

  function runDrop(execute: boolean, confirmation?: string): Promise<DbAdminStatementsResult> {
    return dropObject(connectionId, drop!.kind, drop!.ref, execute, confirmation);
  }

  function afterDrop() {
    const kind = drop?.kind;
    drop = null;
    if (kind === "database") onDatabaseDropped();
    else if (kind === "column") description.reload();
    else {
      selected = null;
      tables.reload();
    }
  }

  const dropTooltip = $derived(overview.readOnly ? t("dbadmin.readOnlyConnection") : undefined);
</script>

<div class="grid grid-cols-1 gap-4 md:grid-cols-12">
  <div class="space-y-2 md:col-span-4 lg:col-span-3">
    {#if capabilities.multiDatabase}
      <div class="flex items-center gap-1">
        <Select
          size="sm"
          class="min-w-0 flex-1"
          bind:value={database}
          options={overview.databases.map((db) => ({
            value: db.name,
            label: `${db.name}${db.sizeBytes !== null ? ` — ${formatBytes(db.sizeBytes)}` : ""}`,
          }))}
          aria-label={t("dbadmin.database")}
        />
        {#if capabilities.dropDatabase}
          <Button
            variant="danger-ghost"
            size="icon-sm"
            disabled={overview.readOnly || !currentDatabase || currentDatabase.system}
            data-tooltip={dropTooltip ?? (currentDatabase?.system ? t("dbadmin.systemObject") : t("dbadmin.explorer.dropDatabase"))}
            onclick={() => (drop = { kind: "database", ref: { database }, name: database })}
          >
            <Icon icon={TrashIcon} size={13} />
          </Button>
        {/if}
      </div>
    {/if}
    {#if capabilities.schemas}
      <Select
        size="sm"
        class="w-full"
        bind:value={schema}
        options={(schemas.data ?? []).map((s) => ({ value: s.name, label: s.name }))}
        aria-label={t("dbadmin.schema")}
      />
    {/if}
    <input class={`${INPUT_SM_CLASS} w-full`} bind:value={filter} placeholder={t("dbadmin.explorer.filterTables")} />

    {#if schemas.error ?? tables.error}<ErrorText>{schemas.error ?? tables.error}</ErrorText>{/if}
    <div class="max-h-[460px] space-y-0.5 overflow-y-auto">
      {#each visibleTables as table (`${table.schema}.${table.name}`)}
        {@const active = selected?.name === table.name && selected?.schema === table.schema}
        <button
          type="button"
          onclick={() => select(table)}
          class={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
            active ? "bg-accent/15 font-semibold text-accent" : "text-text hover:bg-surface-hover"
          }`}
        >
          <Icon icon={TableIcon} size={12} class="shrink-0 text-text-muted" />
          <span class="min-w-0 flex-1 truncate">{table.name}</span>
          {#if table.kind === "view"}
            <span class="shrink-0 text-[10px] text-text-muted uppercase">{t("dbadmin.explorer.view")}</span>
          {:else if table.rowEstimate !== null}
            <span class="shrink-0 text-[10px] text-text-muted tabular-nums">~{formatNumber(table.rowEstimate, i18n.locale)}</span>
          {/if}
        </button>
      {/each}
      {#if visibleTables.length === 0}
        <p class="py-4 text-center text-xs text-text-muted">
          {tables.loading || schemas.loading ? t("common.loading") : t("dbadmin.explorer.noTables")}
        </p>
      {/if}
    </div>
  </div>

  <div class="min-w-0 md:col-span-8 lg:col-span-9">
    {#if !selected || !ref}
      <EmptyState>{t("dbadmin.explorer.pickTable")}</EmptyState>
    {:else}
      {@const table = selected}
      {@const tableRef = ref}
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <span class="font-mono text-[13px] font-semibold">{table.schema ? `${table.schema}.` : ""}{table.name}</span>
        <Badge tone="muted">{table.kind === "view" ? t("dbadmin.explorer.view") : t("dbadmin.explorer.table")}</Badge>
        {#if table.sizeBytes !== null}<span class="text-xs text-text-muted">{formatBytes(table.sizeBytes)}</span>{/if}
        <div class="ml-auto flex items-center gap-2">
          <Tabs
            variant="boxed"
            tabs={[
              { id: "data", label: t("dbadmin.explorer.data") },
              { id: "structure", label: t("dbadmin.explorer.structure") },
            ]}
            activeTab={view}
            onChange={(id) => (view = id)}
          />
          {#if workspace && table.kind === "table"}
            <Button
              variant="outline"
              size="sm"
              data-tooltip={t("dbadmin.explorer.exportAsSeedHint")}
              onclick={() => {
                if (!workspace.seedFromDatabase(table.name)) {
                  toast.warning(t("dbadmin.explorer.exportAsSeedUnavailable", { table: table.name }));
                }
              }}
            >
              <Icon icon={FileSpreadsheetIcon} size={12} />
              {t("dbadmin.explorer.exportAsSeed")}
            </Button>
          {/if}
          <Button
            variant="danger"
            size="sm"
            disabled={overview.readOnly}
            data-tooltip={dropTooltip}
            onclick={() => requestDrop({ kind: table.kind, ref: tableRef, name: table.name })}
          >
            <Icon icon={TrashIcon} size={12} />
            {t("common.delete")}
          </Button>
        </div>
      </div>

      {#if view === "data"}
        {#if rows.error}<ErrorText>{rows.error}</ErrorText>{/if}
        {#if rows.data}
          <ResultGrid result={rows.data} fileName={table.name} />
          <div class="mt-2 flex items-center justify-end gap-2 text-xs text-text-muted">
            <span>{t("dbadmin.explorer.rowRange", { from: offset + 1, to: offset + rows.data.rows.length })}</span>
            <Button variant="ghost" size="icon-xs" disabled={offset === 0 || rows.loading} data-tooltip={t("dbadmin.explorer.previousPage")} onclick={() => (offset = Math.max(0, offset - PAGE_SIZE))}>
              <Icon icon={ChevronLeftIcon} size={13} />
            </Button>
            <Button variant="ghost" size="icon-xs" disabled={!rows.data.truncated || rows.loading} data-tooltip={t("dbadmin.explorer.nextPage")} onclick={() => (offset += PAGE_SIZE)}>
              <Icon icon={ChevronRightIcon} size={13} />
            </Button>
          </div>
        {:else if rows.loading}
          <EmptyState>{t("common.loading")}</EmptyState>
        {/if}
      {:else}
        {#if description.error}<ErrorText>{description.error}</ErrorText>{/if}
        {#if description.data}
          {@const d = description.data}
          <div class="overflow-x-auto rounded-md border border-border">
            <table class="w-full border-collapse text-xs">
              <thead class="bg-surface-raised text-left text-text-secondary">
                <tr>
                  <th class="px-2 py-1.5 font-semibold">{t("dbadmin.explorer.column")}</th>
                  <th class="px-2 py-1.5 font-semibold">{t("dbadmin.explorer.type")}</th>
                  <th class="px-2 py-1.5 font-semibold">{t("dbadmin.explorer.nullable")}</th>
                  <th class="px-2 py-1.5 font-semibold">{t("dbadmin.explorer.default")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each d.columns as column (column.name)}
                  <tr class="border-t border-border/60">
                    <td class="px-2 py-1 font-mono">
                      {#if column.primaryKey}<Icon icon={KeyIcon} size={11} class="mr-1 inline text-warning" />{/if}{column.name}
                    </td>
                    <td class="px-2 py-1 font-mono text-text-secondary">{column.type}</td>
                    <td class="px-2 py-1">{column.nullable ? t("common.yes") : t("common.no")}</td>
                    <td class="max-w-[220px] truncate px-2 py-1 font-mono text-text-muted" title={column.defaultValue ?? ""}>{column.defaultValue ?? ""}</td>
                    <td class="px-1 py-0.5 text-right">
                      {#if table.kind === "table"}
                        <Button
                          variant="danger-ghost"
                          size="icon-xs"
                          disabled={overview.readOnly}
                          data-tooltip={dropTooltip ?? t("dbadmin.explorer.dropColumn")}
                          onclick={() => requestDrop({ kind: "column", ref: { ...tableRef, column: column.name }, name: column.name })}
                        >
                          <Icon icon={TrashIcon} size={11} />
                        </Button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if d.indexes.length > 0}
            <div class="mt-3 mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.explorer.indexes")}</div>
            <ul class="space-y-0.5 text-xs">
              {#each d.indexes as index (index.name)}
                <li class="font-mono">
                  {index.name} <span class="text-text-muted">({index.columns.join(", ")})</span>
                  {#if index.primary}<Badge tone="warning">{PRIMARY_LABEL}</Badge>{:else if index.unique}<Badge tone="muted">{UNIQUE_LABEL}</Badge>{/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if d.constraints.length > 0}
            <div class="mt-3 mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.explorer.constraints")}</div>
            <ul class="space-y-0.5 text-xs">
              {#each d.constraints as constraint (`${constraint.type}:${constraint.name}`)}
                <li class="font-mono">
                  {constraint.name} <span class="text-text-secondary">{constraint.type}</span>
                  <span class="text-text-muted">{constraint.definition}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if description.loading}
          <EmptyState>{t("common.loading")}</EmptyState>
        {/if}
      {/if}
    {/if}
  </div>
</div>

{#if drop}
  <StatementModal
    title={t(`dbadmin.drop.title.${drop.kind}`, { name: drop.name })}
    hint={policyApplies(drop.kind) && policy.policy === "warn"
      ? `${t("dbadmin.drop.hint")} ${t("dbadmin.structure.warnHint")}`
      : t("dbadmin.drop.hint")}
    confirmName={drop.name}
    danger
    run={runDrop}
    onClose={() => (drop = null)}
    onDone={afterDrop}
  />
{/if}
{#if redirect}
  <StructureRedirectDialog refusal={redirect} onClose={() => (redirect = null)} />
{/if}
