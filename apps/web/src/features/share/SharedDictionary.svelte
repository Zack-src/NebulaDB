<script lang="ts">
  import {
    completenessPercent,
    dictionaryToHtml,
    type DataClassification,
    type DataDictionary,
  } from "@nebuladb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { DownloadIcon, TableIcon } from "@/components/icons/Icons";
  import Badge, { type BadgeTone } from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import { dictionaryPdfLabels } from "@/features/editor/dictionary/dictionaryPdfLabels";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { triggerDownload } from "@/utils/download";

  /**
   * The shared data dictionary, read-only: what the editor's dictionary tab
   * shows, without the inputs, and with its HTML and PDF exports. The server
   * sent it already stripped of what a stranger must not see (the `owner`
   * annotation among others), so the exports carry no more than the page.
   */
  let { dictionary }: { dictionary: DataDictionary } = $props();

  const { t } = useTranslation();
  /** File formats' own names, not prose — never translated. */
  const FORMAT_NAME = { html: "HTML", pdf: "PDF" } as const;
  const TONE: Record<DataClassification, BadgeTone> = {
    public: "success",
    internal: "muted",
    personal: "warning",
    sensitive: "danger",
  };
  const PAGE = 40;
  let search = $state("");
  let shown = $state(PAGE);

  const percent = $derived(completenessPercent(dictionary));
  const matching = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return dictionary.tables;
    return dictionary.tables.filter((table) =>
      [table.name, table.description, ...table.tags]
        .concat(table.columns.flatMap((column) => [column.name, column.description, ...column.tags]))
        .some((text) => text.toLowerCase().includes(needle)),
    );
  });
  const visible = $derived(matching.slice(0, shown));
  const matchingEnums = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return dictionary.enums;
    return dictionary.enums.filter((def) =>
      [def.name, ...def.values.flatMap((value) => [value.name, value.description])].some((text) =>
        text.toLowerCase().includes(needle),
      ),
    );
  });

  const fileBase = $derived(`${dictionary.projectName.replace(/[^\w.-]+/g, "_")}-dictionary`);
  function downloadHtml() {
    const url = URL.createObjectURL(new Blob([dictionaryToHtml(dictionary)], { type: "text/html;charset=utf-8" }));
    triggerDownload(url, `${fileBase}.html`, true);
  }
  let makingPdf = $state(false);
  async function downloadPdf() {
    makingPdf = true;
    try {
      const { dictionaryToPdf } = await import("@/features/editor/dictionary/dictionaryPdf");
      const blob = await dictionaryToPdf(dictionary, dictionaryPdfLabels(dictionary, t, i18n.locale));
      triggerDownload(URL.createObjectURL(blob), `${fileBase}.pdf`, true);
    } finally {
      makingPdf = false;
    }
  }
</script>

<div class="min-h-0 flex-1 overflow-y-auto bg-bg" data-testid="share-dictionary">
  <div class="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="m-0 flex-1 text-heading font-semibold text-text">{t("dictionary.title")}</h2>
      <Button size="sm" variant="outline" onclick={downloadHtml}>
        <Icon icon={DownloadIcon} size={12} />
        {FORMAT_NAME.html}
      </Button>
      <Button size="sm" variant="outline" disabled={makingPdf} onclick={downloadPdf}>
        <Icon icon={DownloadIcon} size={12} />
        {FORMAT_NAME.pdf}
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <span class="flex-1 text-xs text-text-secondary">
        {t("dictionary.described", {
          percent,
          tables: `${dictionary.completeness.describedTables}/${dictionary.completeness.tables}`,
          columns: `${dictionary.completeness.describedColumns}/${dictionary.completeness.columns}`,
        })}
      </span>
      <input
        class={`${INPUT_SM_CLASS} w-52`}
        type="search"
        placeholder={t("dictionary.search")}
        aria-label={t("dictionary.search")}
        bind:value={search}
      />
    </div>

    {#if visible.length === 0 && matchingEnums.length === 0}
      <EmptyState>{dictionary.tables.length === 0 ? t("dictionary.empty") : t("dictionary.emptyFilter")}</EmptyState>
    {/if}
    {#each visible as table (table.id)}
      <section class="rounded-md border border-border bg-surface text-xs" data-table={table.name}>
        <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Icon icon={TableIcon} size={13} />
          <span class="font-mono text-body-sm font-semibold text-text">
            {table.schemaName ? `${table.schemaName}.` : ""}{table.name}
          </span>
          {#if table.classification}
            <Badge tone={TONE[table.classification]}>{t(`dictionary.class.${table.classification}`)}</Badge>
          {/if}
          {#each table.tags as tag (tag)}
            <Badge tone="muted">{tag}</Badge>
          {/each}
        </div>
        {#if table.description}
          <p class="m-0 whitespace-pre-line border-b border-border px-3 py-2 text-text-secondary">{table.description}</p>
        {/if}
        <table class="w-full border-collapse" aria-label={t("dictionary.columnsOf", { name: table.name })}>
          <tbody>
            {#each table.columns as column (column.id)}
              <tr class="border-b border-border last:border-b-0" data-column={column.name}>
                <td class="w-[26%] px-3 py-1.5 align-top">
                  <span class="font-mono font-semibold text-text">{column.name}</span>
                  <span class="block font-mono text-caption text-text-muted">
                    {[column.type, ...column.constraints].join(" · ")}
                  </span>
                </td>
                <td class="whitespace-pre-line px-3 py-1.5 align-top text-text-secondary">{column.description}</td>
                <td class="w-48 px-3 py-1.5 text-right align-top">
                  <span class="inline-flex flex-wrap justify-end gap-1">
                    {#if column.classification}
                      <Badge tone={TONE[column.classification]}>{t(`dictionary.class.${column.classification}`)}</Badge>
                    {/if}
                    {#each column.tags as tag (tag)}
                      <Badge tone="muted">{tag}</Badge>
                    {/each}
                  </span>
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
                  <td class="w-[26%] px-3 py-1 font-mono font-semibold text-text">{value.name}</td>
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
