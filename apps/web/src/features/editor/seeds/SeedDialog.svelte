<script lang="ts" module>
  import type { SeedIssueKind, SeedSeparator } from "@athanordb/shared";

  const SEPARATOR_LABEL: Record<SeedSeparator, string> = { ",": ",", ";": ";", "\t": "Tab", "|": "|" };
  const PREVIEW_ROWS = 20;
  const LISTED_ISSUES = 30;
  const ISSUE_KEY: Record<SeedIssueKind, string> = {
    "not-null": "seeds.issue.notNull",
    type: "seeds.issue.type",
    length: "seeds.issue.length",
    unique: "seeds.issue.unique",
    "foreign-key": "seeds.issue.foreignKey",
    "missing-column": "seeds.issue.missingColumn",
    formula: "seeds.issue.formula",
    width: "seeds.issue.width",
    "column-gone": "seeds.issue.columnGone",
  };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import {
    SEED_MAX_BYTES,
    SEED_MODES,
    SEED_SEPARATORS,
    detectSeparator,
    parseCsv,
    seedRows,
    suggestMapping,
    validateSeed,
    type SeedMode,
    type SeedOptions,
    type Ref,
    type Table,
    type TableSeedSummary,
  } from "@athanordb/shared";
  import Tabs from "@/components/ui/Tabs.svelte";
  import GeneratePanel from "./GeneratePanel.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { DatabaseIcon, FileSpreadsheetIcon, UploadIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Select from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import { deleteSeed, fetchSeed, readSeedFromDatabase, saveSeed } from "@/services/seedsApi";

  /**
   * "Données initiales" of one table: a CSV file, how to read it, which column
   * goes where, and a preview checked against the table (types, NOT NULL,
   * lengths, duplicates). The same check runs on the server before every
   * deployment — foreign keys against the parent table's seed are checked
   * there, with all seeds at hand.
   */
  let {
    projectId,
    table,
    refs = [],
    existing,
    canEdit,
    database = null,
    loadFromDatabase = false,
    onClose,
  }: {
    projectId: string;
    table: Table;
    /** The project's relations — which columns are foreign keys, for the generator's suggestions. */
    refs?: readonly Ref[];
    existing: TableSeedSummary | null;
    /** False for a view grant, or when a `full` lock binds this user. */
    canEdit: boolean;
    /** The workspace's current database, when this user may read its rows (instance administrators): offers "take the rows it holds". */
    database?: { id: string; name: string } | null;
    /** Read the database's rows as soon as the dialog opens — it was opened from the console for that. */
    loadFromDatabase?: boolean;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let content = $state<string | null>(null);
  let fileName = $state<string | null>(null);
  let separator = $state<SeedSeparator>(",");
  let header = $state(true);
  let mode = $state<SeedMode>("if-empty");
  let mapping = $state.raw<(string | null)[]>([]);
  let loadError = $state<string | null>(null);
  let confirmingRemove = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let tab = $state<"file" | "generate">("file");

  /** Generated rows become the dialog's file: checked and saved the same way. */
  function useGenerated(csv: string, generatedMapping: string[]) {
    content = csv;
    fileName = t("generator.fileName");
    separator = ",";
    header = true;
    mapping = generatedMapping;
    tab = "file";
  }

  $effect(() => {
    if (!existing) return;
    fetchSeed(projectId, existing.tableId)
      .then((seed) => {
        // Rows read from the database meanwhile are what the person asked for.
        if (content !== null) return;
        content = seed.content;
        separator = seed.options.separator;
        header = seed.options.header;
        mode = seed.options.mode;
        mapping = seed.options.mapping;
      })
      .catch((err: unknown) => (loadError = describeApiError(err, t)));
  });

  const parsed = $derived(content === null ? [] : parseCsv(content, separator));
  const headers = $derived(
    (parsed[0] ?? []).map((cell, i) => (header ? cell || t("seeds.column", { n: i + 1 }) : t("seeds.column", { n: i + 1 }))),
  );
  const options = $derived<SeedOptions>({ separator, header, mapping, mode });
  const validation = $derived(content === null ? null : validateSeed(table, parsed, options));
  const preview = $derived(content === null ? null : seedRows(parsed.slice(0, PREVIEW_ROWS + (header ? 1 : 0)), options, table));
  const rowCount = $derived(Math.max(0, parsed.length - (header ? 1 : 0)));
  const errorCount = $derived(validation ? validation.issues.filter((issue) => issue.severity === "error").length : 0);
  /** `row:column` → the issue, to mark preview cells. */
  const issueAt = $derived(
    new Map((validation?.issues ?? []).filter((issue) => issue.column).map((issue) => [`${issue.row}:${issue.column}`, issue])),
  );

  const fieldOptions = $derived([
    { value: "", label: t("seeds.ignore") },
    ...table.fields.map((field) => ({ value: field.id, label: field.name, hint: field.type })),
  ]);

  /** Reads the CSV; a file that is not UTF-8 (it shows U+FFFD) is read again as Windows-1252, the usual spreadsheet export. */
  async function readFile(file: File) {
    loadError = null;
    if (file.size > SEED_MAX_BYTES) {
      loadError = t("seeds.tooBig", { max: Math.round(SEED_MAX_BYTES / 1_000_000) });
      return;
    }
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer);
    content = text;
    fileName = file.name;
    databaseNote = null;
    separator = detectSeparator(text);
    const first = parseCsv(text.split(/\r?\n/, 1)[0] ?? "", separator)[0] ?? [];
    mapping = header ? suggestMapping(first, table.fields) : first.map((_, i) => table.fields[i]?.id ?? null);
  }

  /** What the last read from the database left out or cut — said next to the file. */
  let databaseNote = $state<string | null>(null);
  const fromDatabase = useAsyncAction(async () => {
    if (!database) return;
    const seed = await readSeedFromDatabase(projectId, table.id, database.id);
    content = seed.content;
    fileName = t("seeds.fromDatabase.fileName", { database: database.name });
    separator = ",";
    header = true;
    mapping = seed.mapping;
    tab = "file";
    databaseNote =
      [
        seed.truncated ? t("seeds.fromDatabase.truncated", { count: seed.rowCount }) : null,
        seed.skippedColumns.length > 0
          ? t("seeds.fromDatabase.skipped", { columns: seed.skippedColumns.join(", ") })
          : null,
      ]
        .filter(Boolean)
        .join(" ") || null;
  });
  $effect(() => {
    if (untrack(() => loadFromDatabase && canEdit)) void untrack(() => fromDatabase.run());
  });

  function setHeader(next: boolean) {
    header = next;
    const first = parsed[0] ?? [];
    mapping = next ? suggestMapping(first, table.fields) : first.map((_, i) => table.fields[i]?.id ?? null);
  }

  function setSeparator(next: SeedSeparator) {
    separator = next;
    const first = (content === null ? [] : parseCsv(content, next))[0] ?? [];
    mapping = header ? suggestMapping(first, table.fields) : first.map((_, i) => table.fields[i]?.id ?? null);
  }

  function setMapping(index: number, fieldId: string) {
    const next = [...mapping];
    next[index] = fieldId || null;
    mapping = next;
  }

  const save = useAsyncAction(async () => {
    if (content === null) return;
    await saveSeed(projectId, table.id, { content, options });
    toast.success(t("seeds.saved", { table: table.name, count: rowCount }));
    onClose();
  });
  const remove = useAsyncAction(async () => {
    await deleteSeed(projectId, table.id);
    toast.success(t("seeds.removed", { table: table.name }));
    onClose();
  });
  const busy = $derived(save.pending || remove.pending);
  const describe = (kind: SeedIssueKind) => t(ISSUE_KEY[kind] as TranslationKeyOf);
</script>

<Modal title={t("seeds.title", { table: table.name })} {onClose} wide dismissable={!busy}>
  <div class="flex flex-col gap-3 text-body-sm">
    <Hint>{t("seeds.hint")}</Hint>
    <Tabs
      variant="line"
      tabs={[
        { id: "file", label: t("seeds.tabFile") },
        { id: "generate", label: t("seeds.tabGenerate") },
      ]}
      activeTab={tab}
      onChange={(next) => (tab = next)}
    />
    {#if tab === "generate"}
      <GeneratePanel {projectId} {table} {refs} {canEdit} onUse={useGenerated} />
    {:else}

    <div class="flex flex-wrap items-center gap-2">
      <Icon icon={FileSpreadsheetIcon} size={15} class="text-text-muted" />
      <span class="min-w-0 flex-1 truncate">
        {#if content !== null}
          <span class="font-semibold">{fileName ?? t("seeds.currentFile")}</span>
          <span class="text-text-muted">· {t("seeds.rows", { count: rowCount })}</span>
        {:else if existing}
          <span class="text-text-muted">{t("common.loading")}</span>
        {:else}
          <span class="text-text-muted">{t("seeds.empty")}</span>
        {/if}
      </span>
      {#if canEdit}
        <input
          bind:this={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          class="hidden"
          aria-label={t("seeds.chooseFile")}
          onchange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void readFile(file);
            event.currentTarget.value = "";
          }}
        />
        <Button size="sm" variant="outline" onclick={() => fileInput?.click()} disabled={busy}>
          <Icon icon={UploadIcon} size={13} />
          {content === null ? t("seeds.chooseFile") : t("seeds.replaceFile")}
        </Button>
        {#if database}
          <Button
            size="sm"
            variant="outline"
            onclick={() => void fromDatabase.run()}
            disabled={busy || fromDatabase.pending}
            data-tooltip={t("seeds.fromDatabase.hint", { database: database.name })}
          >
            <Icon icon={DatabaseIcon} size={13} />
            {fromDatabase.pending ? t("common.loading") : t("seeds.fromDatabase.action")}
          </Button>
        {/if}
      {/if}
    </div>
    {#if loadError}<ErrorText>{loadError}</ErrorText>{/if}
    {#if fromDatabase.error}<ErrorText>{fromDatabase.error}</ErrorText>{/if}
    {#if databaseNote}<Hint>{databaseNote}</Hint>{/if}

    {#if content !== null}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="flex items-center gap-2">
          <span id="seed-separator" class="text-xs text-text-muted">{t("seeds.separator")}</span>
          <Select
            size="sm"
            class="w-20"
            aria-labelledby="seed-separator"
            value={separator}
            options={SEED_SEPARATORS.map((value) => ({ value, label: SEPARATOR_LABEL[value] }))}
            disabled={!canEdit}
            onChange={setSeparator}
          />
        </span>
        <span class="flex items-center gap-2">
          <Switch size="sm" checked={header} disabled={!canEdit} onChange={setHeader} aria-label={t("seeds.header")} />
          <span class="text-xs">{t("seeds.header")}</span>
        </span>
        <span class="flex items-center gap-2">
          <span id="seed-mode" class="text-xs text-text-muted">{t("seeds.mode")}</span>
          <SegmentedControl
            size="sm"
            aria-labelledby="seed-mode"
            value={mode}
            options={SEED_MODES.map((value) => ({
              value,
              label: t(`seeds.modeLabel.${value}`),
              tooltip: t(`seeds.modeHint.${value}`),
              disabled: !canEdit,
            }))}
            onChange={(value) => (mode = value)}
          />
        </span>
      </div>

      <!-- One column of the file per row: where it goes in the table. -->
      <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
        <span class="text-caption font-semibold uppercase text-text-muted">{t("seeds.csvColumn")}</span>
        <span></span>
        <span class="text-caption font-semibold uppercase text-text-muted">{t("seeds.tableColumn")}</span>
        {#each headers as name, index (index)}
          <span class="truncate font-mono text-xs">{name}</span>
          <span class="text-text-muted">→</span>
          <Select
            size="sm"
            aria-label={t("seeds.mapTo", { column: name })}
            value={mapping[index] ?? ""}
            options={fieldOptions}
            disabled={!canEdit}
            onChange={(value) => setMapping(index, value)}
          />
        {/each}
      </div>

      {#if preview && preview.columns.length > 0}
        <div class="max-h-[240px] overflow-auto rounded-sm border border-border">
          <table class="w-full border-collapse font-mono text-xs" aria-label={t("seeds.preview")}>
            <thead class="sticky top-0 bg-surface-raised">
              <tr>
                <th class="border-b border-border px-2 py-1 text-left text-text-muted">#</th>
                {#each preview.columns as field (field.id)}
                  <th class="border-b border-border px-2 py-1 text-left">{field.name}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each preview.rows as row, r (r)}
                <tr>
                  <td class="px-2 py-0.5 text-text-muted">{r + 1}</td>
                  {#each row as value, c (c)}
                    {@const issue = issueAt.get(`${r + 1}:${preview.columns[c].name}`)}
                    <td
                      class={`max-w-[220px] truncate px-2 py-0.5 ${issue ? (issue.severity === "error" ? "bg-danger-light text-danger" : "bg-warning-light text-warning") : ""}`}
                      data-tooltip={issue ? describe(issue.kind) : undefined}
                    >
                      {value === null ? "NULL" : value}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if validation}
        {#if validation.total === 0}
          <p class="text-xs text-success">{t("seeds.valid")}</p>
        {:else}
          <div class="rounded-sm border border-border bg-surface-raised p-2 text-xs" role="status">
            <p class="mb-1 font-semibold">{t("seeds.issues", { count: validation.total })}</p>
            <ul class="max-h-[120px] space-y-0.5 overflow-y-auto">
              {#each validation.issues.slice(0, LISTED_ISSUES) as issue, index (index)}
                <li class={issue.severity === "error" ? "text-danger" : "text-warning"}>
                  {issue.row > 0 ? t("seeds.atRow", { row: issue.row }) : ""}
                  {issue.column ? `${issue.column} — ` : ""}{describe(issue.kind)}{issue.value !== undefined
                    ? ` (${issue.value})`
                    : ""}
                </li>
              {/each}
            </ul>
            {#if errorCount > 0}<p class="mt-1 text-text-muted">{t("seeds.blocksDeployment")}</p>{/if}
          </div>
        {/if}
      {/if}
    {/if}

    {/if}
    {#if save.error ?? remove.error}<ErrorText>{save.error ?? remove.error}</ErrorText>{/if}

    <div class="flex items-center gap-2 border-t border-border pt-3">
      {#if existing && canEdit}
        <Button size="sm" variant="danger-ghost" onclick={() => (confirmingRemove = true)} disabled={busy}>
          {t("seeds.remove")}
        </Button>
      {/if}
      <span class="flex-1"></span>
      <Button size="sm" variant="ghost" onclick={onClose} disabled={busy}>{t("common.cancel")}</Button>
      {#if canEdit}
        <Button size="sm" variant="primary" onclick={() => void save.run()} disabled={busy || content === null}>
          {save.pending ? t("common.saving") : t("common.save")}
        </Button>
      {/if}
    </div>
  </div>
</Modal>

{#if confirmingRemove}
  <ConfirmDialog
    title={t("seeds.removeTitle", { table: table.name })}
    message={t("seeds.removeMessage")}
    danger="warning"
    confirmLabel={t("seeds.remove")}
    pending={remove.pending}
    onCancel={() => (confirmingRemove = false)}
    onConfirm={() => void remove.run()}
  />
{/if}
