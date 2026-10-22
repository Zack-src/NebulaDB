<script lang="ts" module>
  import type { SeedIssueKind, SeedSeparator } from "@nebuladb/shared";

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
    type SeedIssue,
    type SeedMode,
    type SeedOptions,
    type Ref,
    type Table,
    type TableSeedSummary,
  } from "@nebuladb/shared";
  import Tabs from "@/components/ui/Tabs.svelte";
  import GeneratePanel from "./GeneratePanel.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { DatabaseIcon, FileSpreadsheetIcon, UploadIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Select from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import { formatBytes } from "@/features/sql/format";
  import {
    deleteSeed,
    fetchSeed,
    fetchSeedPreview,
    importSeedFolder,
    importSeedFromPath,
    readSeedFromDatabase,
    saveSeed,
    saveSeedOptions,
    uploadSeedFile,
    type SeedFileResult,
  } from "@/services/seedsApi";

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
    isAdmin = false,
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
    /** An instance administrator: may also import files from the server's import folder. */
    isAdmin?: boolean;
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

  /**
   * A CSV past what the database holds (SEED_MAX_BYTES) is not read here: only its first lines are (a sample,
   * for the mapping and a preview) and the file goes up as it is, to be kept and checked on the server.
   */
  /** The seed as the server now holds it, once a file has gone up from this dialog. */
  let existingFile = $state.raw<TableSeedSummary | null>(null);
  const current = $derived(existingFile ?? existing);
  let largeFile = $state<File | null>(null);
  let sampleText = $state<string | null>(null);
  /** The first rows of a file already kept on the server, parsed there. */
  let serverSample = $state.raw<(string | null)[][]>([]);
  let progress = $state<{ sent: number; total: number } | null>(null);
  /** What the server's check of the whole file found, once it has been sent or read again. */
  let fileResult = $state.raw<SeedFileResult | null>(null);
  const isLarge = $derived(largeFile !== null || (current?.storage === "file" && content === null));
  const largeSample = $derived(
    largeFile !== null ? (sampleText === null ? [] : parseCsv(sampleText, separator)) : serverSample,
  );
  const SAMPLE_BYTES = 256 * 1024;

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
    if (existing.storage === "file") {
      separator = existing.options.separator;
      header = existing.options.header;
      mode = existing.options.mode;
      mapping = existing.options.mapping;
      fetchSeedPreview(projectId, existing.tableId)
        .then((rows) => (serverSample = rows))
        .catch((err: unknown) => (loadError = describeApiError(err, t)));
      return;
    }
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

  const parsed = $derived(content === null ? largeSample : parseCsv(content, separator));
  const headers = $derived(
    (parsed[0] ?? []).map((cell, i) => (header ? cell || t("seeds.column", { n: i + 1 }) : t("seeds.column", { n: i + 1 }))),
  );
  const options = $derived<SeedOptions>({ separator, header, mapping, mode });
  const hasFile = $derived(content !== null || isLarge);
  /** For a big file: its first rows only — the whole file is checked on the server. */
  const validation = $derived(!hasFile ? null : validateSeed(table, parsed, options));
  const preview = $derived(!hasFile ? null : seedRows(parsed.slice(0, PREVIEW_ROWS + (header ? 1 : 0)), options, table));
  /** `null`: a big file that has not been read through yet — its rows are counted on the server. */
  const rowCount = $derived(
    content !== null ? Math.max(0, parsed.length - (header ? 1 : 0)) : largeFile !== null ? null : (current?.rowCount ?? null),
  );
  /** What the issues panel lists: the server's check of the whole file once there is one, else this dialog's check. */
  const shown = $derived<{ issues: SeedIssue[]; total: number } | null>(fileResult ?? validation);
  const errorCount = $derived(shown ? shown.issues.filter((issue) => issue.severity === "error").length : 0);
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
    fileResult = null;
    if (file.size > SEED_MAX_BYTES) {
      await readLargeFile(file);
      return;
    }
    largeFile = null;
    sampleText = null;
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

  /** A file too big for the database: its first lines are read here, the rest goes to the server as it is. */
  async function readLargeFile(file: File) {
    const bytes = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
    const text = new TextDecoder("utf-8").decode(bytes);
    // The slice may end inside a character: only a replacement character before its last bytes is a real one.
    if (text.slice(0, -4).includes("�")) {
      loadError = t("seeds.large.notUtf8");
      return;
    }
    const cut = text.lastIndexOf("\n");
    const sample = file.size > SAMPLE_BYTES && cut > 0 ? text.slice(0, cut + 1) : text;
    content = null;
    largeFile = file;
    sampleText = sample;
    serverSample = [];
    fileName = file.name;
    databaseNote = null;
    separator = detectSeparator(sample);
    const first = parseCsv(sample.split(/\r?\n/, 1)[0] ?? "", separator)[0] ?? [];
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
    const first = (content !== null ? parseCsv(content, next) : sampleText !== null ? parseCsv(sampleText, next) : [])[0] ?? [];
    mapping = header ? suggestMapping(first, table.fields) : first.map((_, i) => table.fields[i]?.id ?? null);
  }

  function setMapping(index: number, fieldId: string) {
    const next = [...mapping];
    next[index] = fieldId || null;
    mapping = next;
  }

  const save = useAsyncAction(async () => {
    if (largeFile !== null || (isLarge && content === null)) {
      progress = null;
      try {
        const result =
          largeFile !== null
            ? await uploadSeedFile(projectId, table.id, largeFile, options, (sent, total) => (progress = { sent, total }))
            : await saveSeedOptions(projectId, table.id, options);
        finishFile(result);
      } finally {
        progress = null;
      }
      return;
    }
    if (content === null) return;
    await saveSeed(projectId, table.id, { content, options });
    toast.success(t("seeds.saved", { table: table.name, count: rowCount ?? 0 }));
    onClose();
  });

  /** A file went up (or was read again): the server's check of all of it is shown, and the dialog closes only when it is clean. */
  function finishFile(result: SeedFileResult) {
    toast.success(t("seeds.large.saved", { table: table.name, count: result.seed.rowCount }));
    if (result.total === 0) {
      onClose();
      return;
    }
    fileResult = result;
    largeFile = null;
    sampleText = null;
    existingFile = result.seed;
  }
  // The server's import folder: a file by path, or a whole folder named after the tables.
  let serverPath = $state("");
  let serverFolder = $state("");
  let serverOpen = $state(false);
  const importPath = useAsyncAction(async () => {
    if (!serverPath.trim()) return;
    finishFile(await importSeedFromPath(projectId, table.id, serverPath.trim()));
  });
  const importFolder = useAsyncAction(async () => {
    const results = await importSeedFolder(projectId, serverFolder.trim() || ".");
    const imported = results.filter((r) => r.status === "imported").length;
    const skipped = results.filter((r) => r.status === "no-table").length;
    const failed = results.filter((r) => r.status === "failed");
    toast.success(t("seeds.server.folderResult", { imported, skipped, failed: failed.length }));
    if (failed.length > 0) toast.warning(failed.map((r) => `${r.file}: ${r.message ?? ""}`).join(" · "));
    onClose();
  });
  const remove = useAsyncAction(async () => {
    await deleteSeed(projectId, table.id);
    toast.success(t("seeds.removed", { table: table.name }));
    onClose();
  });
  const busy = $derived(save.pending || remove.pending || importPath.pending || importFolder.pending);
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
          <span class="text-text-muted">· {t("seeds.rows", { count: rowCount ?? 0 })}</span>
        {:else if largeFile}
          <span class="font-semibold">{fileName}</span>
          <span class="text-text-muted">· {formatBytes(largeFile.size)} · {t("seeds.large.badge")}</span>
        {:else if current?.storage === "file"}
          <span class="font-semibold">{t("seeds.large.onServer")}</span>
          <span class="text-text-muted">· {formatBytes(current.bytes)} · {t("seeds.rows", { count: current.rowCount })}</span>
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
    {#if progress}
      <div class="flex items-center gap-2 text-xs text-text-muted" role="status">
        <progress class="h-1.5 flex-1" max={progress.total} value={progress.sent}></progress>
        <span>{t("seeds.large.uploading", { percent: Math.round((progress.sent / Math.max(1, progress.total)) * 100) })}</span>
      </div>
    {/if}
    {#if loadError}<ErrorText>{loadError}</ErrorText>{/if}
    {#if fromDatabase.error}<ErrorText>{fromDatabase.error}</ErrorText>{/if}
    {#if databaseNote}<Hint>{databaseNote}</Hint>{/if}
    {#if isAdmin && canEdit}
      <div class="flex flex-col gap-2 rounded-sm border border-border p-2">
        <button
          type="button"
          class="flex items-center gap-1.5 self-start text-xs font-semibold text-primary hover:text-primary-hover"
          aria-expanded={serverOpen}
          onclick={() => (serverOpen = !serverOpen)}
        >
          <Icon icon={DatabaseIcon} size={13} />
          {t("seeds.server.action")}
        </button>
        {#if serverOpen}
          <Hint>{t("seeds.server.hint")}</Hint>
          <div class="flex items-center gap-2">
            <Input
              inputSize="sm"
              class="flex-1"
              bind:value={serverPath}
              placeholder={t("seeds.server.pathPlaceholder", { table: table.name })}
              aria-label={t("seeds.server.pathLabel")}
            />
            <Button size="sm" variant="outline" onclick={() => void importPath.run()} disabled={busy || !serverPath.trim()}>
              {importPath.pending ? t("common.loading") : t("seeds.server.importFile")}
            </Button>
          </div>
          <div class="flex items-center gap-2">
            <Input
              inputSize="sm"
              class="flex-1"
              bind:value={serverFolder}
              placeholder={t("seeds.server.folderPlaceholder")}
              aria-label={t("seeds.server.folderLabel")}
            />
            <Button size="sm" variant="outline" onclick={() => void importFolder.run()} disabled={busy}>
              {importFolder.pending ? t("common.loading") : t("seeds.server.importFolder")}
            </Button>
          </div>
          {#if importPath.error ?? importFolder.error}<ErrorText>{importPath.error ?? importFolder.error}</ErrorText>{/if}
        {/if}
      </div>
    {/if}

    {#if hasFile}
      {#if isLarge}<Hint>{largeFile ? t("seeds.large.sampleHint", { max: Math.round(SEED_MAX_BYTES / 1_000_000) }) : t("seeds.large.serverHint")}</Hint>{/if}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="flex items-center gap-2">
          <span id="seed-separator" class="text-xs text-text-muted">{t("seeds.separator")}</span>
          <Select
            size="sm"
            class="w-20"
            aria-labelledby="seed-separator"
            value={separator}
            options={SEED_SEPARATORS.map((value) => ({ value, label: SEPARATOR_LABEL[value] }))}
            disabled={!canEdit || (current?.storage === "file" && largeFile === null && content === null)}
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

      {#if shown}
        {#if isLarge && !fileResult}<p class="text-xs text-text-muted">{t("seeds.large.sampleOnly")}</p>{/if}
        {#if shown.total === 0}
          <p class="text-xs text-success">{t("seeds.valid")}</p>
        {:else}
          <div class="rounded-sm border border-border bg-surface-raised p-2 text-xs" role="status">
            <p class="mb-1 font-semibold">{t("seeds.issues", { count: shown.total })}</p>
            <ul class="max-h-[120px] space-y-0.5 overflow-y-auto">
              {#each shown.issues.slice(0, LISTED_ISSUES) as issue, index (index)}
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
        <Button size="sm" variant="primary" onclick={() => void save.run()} disabled={busy || (content === null && !isLarge)}>
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
