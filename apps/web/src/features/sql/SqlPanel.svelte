<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon } from "@/components/icons/Icons";
  import { untrack } from "svelte";
  import type { DbAdminQueryHistoryEntry, DbAdminQueryResult, StructurePolicyRefusal } from "@athanordb/shared";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import Select from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { ApiError } from "@/services/ApiError";
  import { clearQueryHistory, fetchQueryHistory, runAdminQuery, type ConnectionOverview } from "@/services/dbAdminApi";
  import { parseServerTime } from "./format";
  import ResultGrid from "./ResultGrid.svelte";
  import StructureRedirectDialog, { describeStructuralAction } from "./StructureRedirectDialog.svelte";

  /**
   * The SQL console. Read-only is the resting state: the server refuses
   * anything but a single reading statement unless write mode is switched on
   * here, and each write-mode run asks once more before it is sent.
   */
  let {
    connectionId,
    overview,
    database = $bindable(),
    request = null,
    compact = false,
    readOnly = false,
    fixedDatabase = false,
  }: {
    connectionId: string;
    overview: ConnectionOverview;
    database: string;
    /**
     * A statement to load and run, from outside the panel ("Voir les données"
     * on a table). A new `token` means a new request, even for the same SQL.
     * Always run read-only, whatever mode the panel was in: the caller asked
     * to look at something.
     */
    request?: { sql: string; token: number } | null;
    /** A shorter editor — for the drawer under the schema, where height is the scarce thing. */
    compact?: boolean;
    readOnly?: boolean;
    fixedDatabase?: boolean;
  } = $props();

  const { t } = useTranslation();
  const RUN_SHORTCUT = "Ctrl + Enter";
  /** A member granted `read` has no write mode at all; the server would refuse it anyway. */
  const canWrite = $derived(!readOnly && overview.access !== "read");
  let sql = $state("");
  let writeMode = $state(false);
  let result = $state.raw<DbAdminQueryResult | null>(null);
  const history = useAsyncResource(() => fetchQueryHistory(connectionId));
  const historyId = $props.id();
  let historyOpen = $state(false);
  const clearHistory = useAsyncAction(async () => {
    await clearQueryHistory(connectionId);
    history.reload();
  });

  // The two answers of the structure policy are not errors to print under the
  // editor: one sends the user to the schema, the other asks a question.
  let redirect = $state.raw<StructurePolicyRefusal | null>(null);
  let toConfirm = $state.raw<StructurePolicyRefusal | null>(null);

  const execute = useAsyncAction(async (confirmStructural: boolean = false) => {
    result = null;
    try {
      result = await runAdminQuery(connectionId, sql, {
        database: database || undefined,
        readOnly: readOnly || !writeMode,
        editor: fixedDatabase || undefined,
        confirmStructural: confirmStructural || undefined,
        // Only ever sent after the write dialog below: what the server asks of a member with `write` access.
        confirmWrite: (!readOnly && writeMode) || undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRUCTURE_VIA_SCHEMA") {
        redirect = err.details as unknown as StructurePolicyRefusal;
      } else if (err instanceof ApiError && err.code === "STRUCTURE_CONFIRMATION_REQUIRED") {
        toConfirm = err.details as unknown as StructurePolicyRefusal;
      } else if (err instanceof ApiError && err.code === "DB_ADMIN_WRITE_NOT_ALLOWED" && !canWrite) {
        // "Switch to write mode" means nothing to someone who has none: say why instead.
        throw new ApiError(err.status, "DB_ACCESS_WRITE_FORBIDDEN", err.message);
      } else throw err;
    } finally {
      history.reload();
    }
  });

  let handledToken: number | null = null;
  $effect(() => {
    const next = request;
    if (!next || next.token === handledToken) return;
    handledToken = next.token;
    untrack(() => {
      sql = next.sql;
      writeMode = false;
      void execute.run();
    });
  });

  /** A write-mode run is asked for first: the statement may change or delete data. */
  let confirmingWrite = $state(false);
  function run() {
    if (!sql.trim() || execute.pending) return;
    if (canWrite && writeMode) confirmingWrite = true;
    else void execute.run();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run();
    }
  }

  function recall(entry: DbAdminQueryHistoryEntry) {
    sql = entry.sql;
    if (!fixedDatabase && entry.database && overview.databases.some((d) => d.name === entry.database))
      database = entry.database;
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-3">
    {#if !fixedDatabase && overview.capabilities.multiDatabase}
      <Select
        size="sm"
        class="min-w-40"
        bind:value={database}
        options={overview.databases.map((db) => ({ value: db.name, label: db.name }))}
        aria-label={t("dbadmin.database")}
      />
    {/if}
    {#if overview.access !== "admin"}
      <span class="text-xs text-text-muted" data-testid="sql-access">
        {t(overview.access === "read" ? "dbAccess.console.read" : "dbAccess.console.write")}
      </span>
    {/if}
    {#if canWrite}
      <!-- A switch, not a checkbox: it takes effect at once, on the next run. -->
      <label
        class={`inline-flex items-center gap-2 text-xs ${overview.readOnly ? "cursor-not-allowed text-text-muted" : "cursor-pointer text-text"}`}
        data-tooltip={overview.readOnly ? t("dbadmin.readOnlyConnection") : undefined}
      >
        <Switch size="sm" bind:checked={writeMode} disabled={overview.readOnly} />
        {t("dbadmin.sql.writeMode")}
      </label>
      <span class={`text-xs ${writeMode ? "font-semibold text-danger" : "text-text-muted"}`}>
        {writeMode ? t("dbadmin.sql.writeModeHint") : t("dbadmin.sql.readOnlyHint")}
      </span>
    {/if}
  </div>

  <textarea
    class={`${TEXTAREA_CODE_CLASS} ${compact ? "!min-h-0 h-20" : "h-40"} w-full ${writeMode ? "!border-danger/60" : ""}`}
    bind:value={sql}
    onkeydown={onKeydown}
    spellcheck="false"
    placeholder="SELECT …"
    aria-label={t("dbadmin.tab.sql")}></textarea>

  <div class="flex items-center gap-2">
    <Button
      variant={writeMode ? "danger" : "primary"}
      size="sm"
      onclick={run}
      disabled={execute.pending || !sql.trim()}
    >
      {execute.pending ? t("dbadmin.sql.running") : t("dbadmin.sql.run")}
    </Button>
    <span class="text-xs text-text-muted">{RUN_SHORTCUT}</span>
  </div>

  {#if execute.error}<ErrorText>{execute.error}</ErrorText>{/if}
  {#if result}<ResultGrid {result} fileName="query" />{/if}

  <div class="border-t border-border pt-3">
    <div class="mb-1.5 flex items-center justify-between gap-2">
      <button
        type="button"
        class="flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text"
        aria-expanded={historyOpen}
        aria-controls={historyId}
        onclick={() => (historyOpen = !historyOpen)}
      >
        <Icon icon={ChevronRightIcon} size={14} class={historyOpen ? "rotate-90" : ""} />
        {t("dbadmin.sql.history")}
      </button>
      <Button
        variant="ghost"
        size="sm"
        disabled={clearHistory.pending || execute.pending || history.loading || !history.data?.length}
        onclick={() => void clearHistory.run()}>{t("dbadmin.sql.clearHistory")}</Button
      >
    </div>
    {#if clearHistory.error}<ErrorText>{clearHistory.error}</ErrorText>{/if}
    {#if historyOpen}
      <div id={historyId}>
        {#if history.error}<ErrorText>{history.error}</ErrorText>{/if}
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
                {#if !entry.readOnly}<span class="shrink-0 font-semibold text-danger">{t("dbadmin.sql.write")}</span
                  >{/if}
                <span class="shrink-0 text-text-muted"
                  >{formatRelativeTime(parseServerTime(entry.createdAt), i18n.locale)}</span
                >
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if redirect}
  <StructureRedirectDialog refusal={redirect} onClose={() => (redirect = null)} />
{/if}
{#if confirmingWrite}
  <ConfirmDialog
    title={t("dbadmin.sql.confirmWriteTitle")}
    message={overview.access === "write" ? t("dbAccess.console.confirmWrite") : t("dbadmin.sql.confirmWrite")}
    danger="danger"
    confirmLabel={t("dbadmin.sql.confirmWriteRun")}
    onCancel={() => (confirmingWrite = false)}
    onConfirm={() => {
      confirmingWrite = false;
      void execute.run();
    }}
  />
{/if}
{#if toConfirm}
  <ConfirmDialog
    title={t("dbadmin.structure.confirmTitle")}
    message={t("dbadmin.structure.confirmMessage", {
      actions: toConfirm.actions.map((action) => describeStructuralAction(action, t)).join(", "),
    })}
    danger="warning"
    confirmLabel={t("dbadmin.structure.confirmRun")}
    onCancel={() => (toConfirm = null)}
    onConfirm={() => {
      toConfirm = null;
      void execute.run(true);
    }}
  />
{/if}
