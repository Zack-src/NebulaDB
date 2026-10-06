<script lang="ts">
  import {
    DATA_CLASSIFICATIONS,
    buildDictionary,
    completenessPercent,
    dictionaryToCsv,
    dictionaryToHtml,
    dictionaryToMarkdown,
    formatNote,
    parseNote,
    type DataClassification,
    type DictionaryTable,
    type NoteMeta,
  } from "@nebuladb/dbml-engine";
  import type { Project } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { DownloadIcon, TableIcon } from "@/components/icons/Icons";
  import Badge, { type BadgeTone } from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { triggerDownload } from "@/utils/download";

  /**
   * "Dictionnaire": what each table and column means — description, owner,
   * classification, tags — read from and written to the elements' DBML notes,
   * so it is part of the schema: versioned, exported and imported with it.
   */
  let {
    project,
    canEdit,
    onOpenTable,
    onSaveTableNote,
    onSaveFieldNote,
  }: {
    project: Project;
    /** `edit` on the project, and no lock that binds this user on the table (a lock freezes notes). */
    canEdit: (tableId: string) => boolean;
    onOpenTable: (tableName: string, fieldName?: string) => void;
    onSaveTableNote: (tableId: string, note: string | undefined) => void;
    onSaveFieldNote: (tableId: string, fieldId: string, note: string | undefined) => void;
  } = $props();

  const { t } = useTranslation();
  /** File formats' own names, not prose — never translated. */
  const FORMAT_NAME = { md: "Markdown", csv: "CSV", html: "HTML" } as const;
  /** So a spreadsheet reads the CSV as UTF-8. */
  const BOM = String.fromCharCode(0xfeff);
  type Filter = "all" | "todo" | "personal";
  /** Tables drawn at once: a page of inputs per table is heavy on a schema of hundreds. */
  const PAGE = 40;
  let filter = $state<Filter>("all");
  let search = $state("");
  let shown = $state(PAGE);

  const dictionary = $derived(buildDictionary(project));
  const percent = $derived(completenessPercent(dictionary));
  const isPersonal = (meta: NoteMeta) => meta.classification === "personal" || meta.classification === "sensitive";

  const matching = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return dictionary.tables.filter((table) => {
      if (filter === "todo" && table.description && table.columns.every((column) => column.description)) return false;
      if (filter === "personal" && !isPersonal(table) && !table.columns.some(isPersonal)) return false;
      if (!needle) return true;
      return [table.name, table.description, table.owner ?? "", ...table.tags]
        .concat(table.columns.flatMap((column) => [column.name, column.description, ...column.tags]))
        .some((text) => text.toLowerCase().includes(needle));
    });
  });
  const visible = $derived(matching.slice(0, shown));
  /** Enums follow the search, not the two table filters: they have nothing to document here and no classification. */
  const matchingEnums = $derived.by(() => {
    if (filter !== "all") return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return dictionary.enums;
    return dictionary.enums.filter((def) =>
      [def.name, ...def.values.flatMap((value) => [value.name, value.description])].some((text) =>
        text.toLowerCase().includes(needle),
      ),
    );
  });

  const filterOptions = $derived<{ value: Filter; label: string }[]>([
    { value: "all", label: t("dictionary.filter.all") },
    { value: "todo", label: t("dictionary.filter.todo") },
    { value: "personal", label: t("dictionary.filter.personal") },
  ]);
  const classificationOptions = $derived([
    { value: "", label: "—" },
    ...DATA_CLASSIFICATIONS.map((value) => ({ value, label: t(`dictionary.class.${value}`) })),
  ]);
  const TONE: Record<DataClassification, BadgeTone> = {
    public: "success",
    internal: "muted",
    personal: "warning",
    sensitive: "danger",
  };

  // Every edit rewrites the element's whole note from its current annotations
  // plus the one that changed — read from the live note, never from this page's
  // copy, so two people documenting the same table do not undo each other's field.
  function patchTable(table: DictionaryTable, patch: Partial<NoteMeta>) {
    const current = parseNote(project.tables.find((candidate) => candidate.id === table.id)?.note);
    onSaveTableNote(table.id, formatNote({ ...current, ...patch }));
  }
  function patchColumn(table: DictionaryTable, fieldId: string, patch: Partial<NoteMeta>) {
    const field = project.tables.find((candidate) => candidate.id === table.id)?.fields.find((f) => f.id === fieldId);
    onSaveFieldNote(table.id, fieldId, formatNote({ ...parseNote(field?.note), ...patch }));
  }
  const toTags = (text: string) =>
    text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  const toClass = (value: string) => (value || undefined) as DataClassification | undefined;

  const fileBase = $derived(`${project.name.replace(/[^\w.-]+/g, "_")}-dictionary`);
  function download(content: string, extension: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    triggerDownload(url, `${fileBase}.${extension}`, true);
  }
</script>

<div class="min-h-0 flex-1 overflow-y-auto bg-bg" data-testid="dictionary">
  <div class="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="m-0 flex-1 text-heading font-semibold text-text">{t("dictionary.title")}</h2>
      <Button size="sm" variant="outline" onclick={() => download(dictionaryToMarkdown(dictionary), "md", "text/markdown")}>
        <Icon icon={DownloadIcon} size={12} />
        {FORMAT_NAME.md}
      </Button>
      <Button size="sm" variant="outline" onclick={() => download(BOM + dictionaryToCsv(dictionary), "csv", "text/csv")}>
        <Icon icon={DownloadIcon} size={12} />
        {FORMAT_NAME.csv}
      </Button>
      <Button size="sm" variant="outline" onclick={() => download(dictionaryToHtml(dictionary), "html", "text/html")}>
        <Icon icon={DownloadIcon} size={12} />
        {FORMAT_NAME.html}
      </Button>
    </div>
    <Hint>{t("dictionary.hint")}</Hint>

    <div class="flex flex-wrap items-center gap-3">
      <div class="flex min-w-[220px] flex-1 items-center gap-2" data-testid="dictionary-completeness">
        <div
          class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t("dictionary.completeness")}
        >
          <div class="h-full bg-primary" style={`width: ${percent}%`}></div>
        </div>
        <span class="text-xs text-text-secondary">
          {t("dictionary.described", {
            percent,
            tables: `${dictionary.completeness.describedTables}/${dictionary.completeness.tables}`,
            columns: `${dictionary.completeness.describedColumns}/${dictionary.completeness.columns}`,
          })}
        </span>
      </div>
      <input
        class={`${INPUT_SM_CLASS} w-52`}
        type="search"
        placeholder={t("dictionary.search")}
        aria-label={t("dictionary.search")}
        bind:value={search}
      />
      <SegmentedControl size="sm" bind:value={filter} options={filterOptions} aria-label={t("dictionary.filter.label")} />
    </div>

    {#if visible.length === 0 && matchingEnums.length === 0}
      <EmptyState>{dictionary.tables.length === 0 ? t("dictionary.empty") : t("dictionary.emptyFilter")}</EmptyState>
    {/if}
    {#each visible as table (table.id)}
      {@const editable = canEdit(table.id)}
      <section class="rounded-md border border-border bg-surface text-xs" data-table={table.name}>
        <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Icon icon={TableIcon} size={13} />
          <button
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 font-mono text-body-sm font-semibold text-text hover:underline"
            onclick={() => onOpenTable(table.name)}
            data-tooltip={t("dictionary.openInSchema")}
          >
            {table.schemaName ? `${table.schemaName}.` : ""}{table.name}
          </button>
          {#if table.classification}
            <Badge tone={TONE[table.classification]}>{t(`dictionary.class.${table.classification}`)}</Badge>
          {/if}
          <span class="flex-1"></span>
          <input
            class={`${INPUT_SM_CLASS} w-40`}
            placeholder={t("dictionary.owner")}
            aria-label={t("dictionary.ownerOf", { name: table.name })}
            value={table.owner ?? ""}
            disabled={!editable}
            onchange={(event) => patchTable(table, { owner: event.currentTarget.value })}
          />
          <Select
            size="sm"
            class="w-36"
            aria-label={t("dictionary.classOf", { name: table.name })}
            value={table.classification ?? ""}
            options={classificationOptions}
            disabled={!editable}
            onChange={(value) => patchTable(table, { classification: toClass(value) })}
          />
        </div>
        <div class="flex flex-wrap gap-2 border-b border-border px-3 py-2">
          <input
            class={`${INPUT_SM_CLASS} min-w-[240px] flex-[3]`}
            placeholder={t("dictionary.tableDescription")}
            aria-label={t("dictionary.descriptionOf", { name: table.name })}
            value={table.description}
            disabled={!editable}
            onchange={(event) => patchTable(table, { description: event.currentTarget.value })}
          />
          <input
            class={`${INPUT_SM_CLASS} min-w-[140px] flex-1`}
            placeholder={t("dictionary.tags")}
            aria-label={t("dictionary.tagsOf", { name: table.name })}
            value={table.tags.join(", ")}
            disabled={!editable}
            onchange={(event) => patchTable(table, { tags: toTags(event.currentTarget.value) })}
          />
        </div>
        <table class="w-full border-collapse" aria-label={t("dictionary.columnsOf", { name: table.name })}>
          <tbody>
            {#each table.columns as column (column.id)}
              <tr class="border-b border-border last:border-b-0" data-column={column.name}>
                <td class="w-[22%] px-3 py-1 align-middle">
                  <span class="font-mono font-semibold text-text">{column.name}</span>
                  <span class="block font-mono text-caption text-text-muted">
                    {[column.type, ...column.constraints].join(" · ")}
                  </span>
                </td>
                <td class="px-1 py-1">
                  <input
                    class={`${INPUT_SM_CLASS} w-full`}
                    placeholder={t("dictionary.columnDescription")}
                    aria-label={t("dictionary.descriptionOf", { name: `${table.name}.${column.name}` })}
                    value={column.description}
                    disabled={!editable}
                    onchange={(event) => patchColumn(table, column.id, { description: event.currentTarget.value })}
                  />
                </td>
                <td class="w-36 px-1 py-1">
                  <Select
                    size="sm"
                    class="w-full"
                    aria-label={t("dictionary.classOf", { name: `${table.name}.${column.name}` })}
                    value={column.classification ?? ""}
                    options={classificationOptions}
                    disabled={!editable}
                    onChange={(value) => patchColumn(table, column.id, { classification: toClass(value) })}
                  />
                </td>
                <td class="w-40 py-1 pl-1 pr-3">
                  <input
                    class={`${INPUT_SM_CLASS} w-full`}
                    placeholder={t("dictionary.tags")}
                    aria-label={t("dictionary.tagsOf", { name: `${table.name}.${column.name}` })}
                    value={column.tags.join(", ")}
                    disabled={!editable}
                    onchange={(event) => patchColumn(table, column.id, { tags: toTags(event.currentTarget.value) })}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/each}
    {#if matching.length > visible.length}
      <Button variant="outline" size="sm" onclick={() => (shown += PAGE)}>
        {t("dictionary.showMore", { count: matching.length - visible.length })}
      </Button>
    {/if}
    {#if matchingEnums.length > 0}
      <h3 class="m-0 mt-2 text-body-sm font-semibold text-text">{t("dictionary.enums")}</h3>
      {#each matchingEnums as def (def.id)}
        <section class="rounded-md border border-border bg-surface text-xs" data-enum={def.name}>
          <div class="flex flex-wrap items-baseline gap-2 border-b border-border px-3 py-2">
            <span class="font-mono text-body-sm font-semibold text-text">{def.name}</span>
            <span class="text-text-muted">
              {def.usedBy.length > 0
                ? t("dictionary.enumUsedBy", { columns: def.usedBy.join(", ") })
                : t("dictionary.enumUnused")}
            </span>
          </div>
          <table class="w-full border-collapse" aria-label={t("dictionary.valuesOf", { name: def.name })}>
            <tbody>
              {#each def.values as value (value.name)}
                <tr class="border-b border-border last:border-b-0">
                  <td class="w-[22%] px-3 py-1 font-mono font-semibold text-text">{value.name}</td>
                  <td class="px-3 py-1 text-text-secondary">{value.description}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/each}
    {/if}
  </div>
</div>
