<script lang="ts">
  import type { DbAdminQueryHistoryEntry, DbAdminQueryResult } from "@athanordb/shared";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { CHECKBOX_CLASS, SELECT_SM_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchQueryHistory, runAdminQuery, type ConnectionOverview } from "@/services/dbAdminApi";
  import { parseServerTime } from "./format";
  import ResultGrid from "./ResultGrid.svelte";

  /**
   * The SQL console. Read-only is the resting state: the server refuses
   * anything but a single reading statement unless write mode is switched on
   * here, and each write-mode run asks once more before it is sent.
   */
  let {
    connectionId,
    overview,
    database = $bindable(),
  }: { connectionId: string; overview: ConnectionOverview; database: string } = $props();

  const { t } = useTranslation();
  const RUN_SHORTCUT = "Ctrl + Enter";
  let sql = $state("");
  let writeMode = $state(false);
  let result = $state.raw<DbAdminQueryResult | null>(null);
  const history = useAsyncResource(() => fetchQueryHistory(connectionId));

  const execute = useAsyncAction(async () => {
    result = null;
    try {
      result = await runAdminQuery(connectionId, sql, { database: database || undefined, readOnly: !writeMode });
    } finally {
      history.reload();
    }
  });

  function run() {
    if (!sql.trim() || execute.pending) return;
    if (writeMode && !window.confirm(t("dbadmin.sql.confirmWrite"))) return;
    void execute.run();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run();
    }
  }

  function recall(entry: DbAdminQueryHistoryEntry) {
    sql = entry.sql;
    if (entry.database && overview.databases.some((d) => d.name === entry.database)) database = entry.database;
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-3">
    {#if overview.capabilities.multiDatabase}
      <select class={SELECT_SM_CLASS} bind:value={database} aria-label={t("dbadmin.database")}>
        {#each overview.databases as db (db.name)}
          <option value={db.name}>{db.name}</option>
        {/each}
      </select>
    {/if}
    <label
      class={`inline-flex items-center gap-1.5 text-xs ${overview.readOnly ? "cursor-not-allowed text-text-muted" : "cursor-pointer text-text"}`}
      data-tooltip={overview.readOnly ? t("dbadmin.readOnlyConnection") : undefined}
    >
      <input type="checkbox" class={CHECKBOX_CLASS} bind:checked={writeMode} disabled={overview.readOnly} />
      {t("dbadmin.sql.writeMode")}
    </label>
    <span class={`text-xs ${writeMode ? "font-semibold text-danger" : "text-text-muted"}`}>
      {writeMode ? t("dbadmin.sql.writeModeHint") : t("dbadmin.sql.readOnlyHint")}
    </span>
  </div>

  <textarea
    class={`${TEXTAREA_CODE_CLASS} h-40 w-full ${writeMode ? "!border-danger/60" : ""}`}
    bind:value={sql}
    onkeydown={onKeydown}
    spellcheck="false"
    placeholder="SELECT …"
    aria-label={t("dbadmin.tab.sql")}
  ></textarea>

  <div class="flex items-center gap-2">
    <Button variant={writeMode ? "danger" : "primary"} size="sm" onclick={run} disabled={execute.pending || !sql.trim()}>
      {execute.pending ? t("dbadmin.sql.running") : t("dbadmin.sql.run")}
    </Button>
    <span class="text-xs text-text-muted">{RUN_SHORTCUT}</span>
  </div>

  {#if execute.error}<ErrorText>{execute.error}</ErrorText>{/if}
  {#if result}<ResultGrid {result} fileName="query" />{/if}

  <div class="border-t border-border pt-3">
    <div class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.sql.history")}</div>
    {#if (history.data ?? []).length === 0}
      <Hint>{history.loading ? t("common.loading") : t("dbadmin.sql.historyEmpty")}</Hint>
    {:else}
      <div class="max-h-56 space-y-1 overflow-y-auto">
        {#each history.data ?? [] as entry (entry.id)}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-surface-hover"
            onclick={() => recall(entry)}
          >
            <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.success ? "bg-success" : "bg-danger"}`}></span>
            <span class="min-w-0 flex-1 truncate font-mono text-text">{entry.sql}</span>
            {#if !entry.readOnly}<span class="shrink-0 font-semibold text-danger">{t("dbadmin.sql.write")}</span>{/if}
            <span class="shrink-0 text-text-muted">{formatRelativeTime(parseServerTime(entry.createdAt), i18n.locale)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
