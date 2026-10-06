<script lang="ts">
  import {
    COLUMN_GENERATORS,
    GENERATOR_LOCALES,
    GENERATOR_MAX_ROWS,
    parseCsv,
    suggestGenerator,
    type ColumnGeneratorConfig,
    type ColumnGeneratorKind,
    type GeneratorLocale,
    type Ref,
    type Table,
    type TableGeneratorConfig,
  } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { DownloadIcon, RestoreIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import NumberInput from "@/components/ui/NumberInput.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import { fetchGeneratorConfig, runGenerator, saveGeneratorConfig, type GeneratorRun } from "@/services/generatorApi";

  /**
   * "Générer": test rows for this table, from its structure only — a
   * generator per column (suggested from the name and type), a volume, a seed
   * that makes the run repeatable, a locale. The rows come from the server's
   * generator (the same code, and the extension point a future provider plugs
   * into); "Use as initial data" hands them to the dialog, where they are
   * checked and saved like any CSV.
   */
  let {
    projectId,
    table,
    refs,
    canEdit,
    onUse,
  }: {
    projectId: string;
    table: Table;
    refs: readonly Ref[];
    canEdit: boolean;
    /** Takes the generated CSV and the field each of its columns fills. */
    onUse: (csv: string, mapping: string[]) => void;
  } = $props();

  const { t } = useTranslation();
  const PREVIEW = 5;
  let rows = $state(100);
  let seed = $state(1);
  let locale = $state<GeneratorLocale>("fr");
  let columns = $state.raw<Record<string, ColumnGeneratorConfig>>({});
  let run = $state.raw<GeneratorRun | null>(null);
  let loadError = $state<string | null>(null);

  // Saved settings first, else what the column names and types suggest.
  $effect(() => {
    const suggested = Object.fromEntries(table.fields.map((field) => [field.id, suggestGenerator(field, table, refs)]));
    fetchGeneratorConfig(projectId, table.id)
      .then((saved) => {
        if (saved) {
          rows = saved.rows;
          seed = saved.seed;
          locale = saved.locale;
        }
        // A field added since the settings were saved gets its suggestion.
        columns = { ...suggested, ...(saved?.columns ?? {}) };
      })
      .catch((err: unknown) => {
        columns = suggested;
        loadError = describeApiError(err, t);
      });
  });

  const config = $derived<TableGeneratorConfig>({ rows, seed, locale, columns });
  const kindOptions = $derived(
    COLUMN_GENERATORS.map((kind) => ({ value: kind, label: t(`generator.kind.${kind}` as TranslationKeyOf) })),
  );

  function setColumn(fieldId: string, patch: Partial<ColumnGeneratorConfig>) {
    columns = { ...columns, [fieldId]: { ...columns[fieldId], ...patch } };
  }

  const generate = useAsyncAction(async () => {
    run = await runGenerator(projectId, table.id, config);
  });

  const preview = $derived(run ? parseCsv(run.csv, ",").slice(0, PREVIEW + 1) : null);

  const use = useAsyncAction(async () => {
    if (!run) return;
    // The settings travel with the rows they produced, so a later run repeats them.
    if (canEdit) await saveGeneratorConfig(projectId, table.id, config);
    onUse(
      run.csv,
      run.columns.map((column) => column.fieldId),
    );
  });

  function exportCsv() {
    if (!run) return;
    const url = URL.createObjectURL(new Blob([run.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${table.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const busy = $derived(generate.pending || use.pending);
  const needsRange = (kind: ColumnGeneratorKind) => ["integer", "decimal", "date", "datetime", "sequence"].includes(kind);
</script>

<div class="flex flex-col gap-3">
  <Hint>{t("generator.hint")}</Hint>
  {#if loadError}<ErrorText>{loadError}</ErrorText>{/if}

  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <span class="flex items-center gap-2">
      <span id="gen-rows" class="text-xs text-text-muted">{t("generator.rows")}</span>
      <NumberInput
        aria-labelledby="gen-rows"
        inputSize="sm"
        class="w-28"
        value={rows}
        min={1}
        max={GENERATOR_MAX_ROWS}
        onChange={(value) => (rows = value ?? 1)}
      />
    </span>
    <span class="flex items-center gap-2">
      <span id="gen-seed" class="text-xs text-text-muted">{t("generator.seed")}</span>
      <NumberInput aria-labelledby="gen-seed" inputSize="sm" class="w-24" value={seed} onChange={(value) => (seed = value ?? 1)} />
    </span>
    <span class="flex items-center gap-2">
      <span id="gen-locale" class="text-xs text-text-muted">{t("generator.locale")}</span>
      <Select
        size="sm"
        class="w-28"
        aria-labelledby="gen-locale"
        value={locale}
        options={GENERATOR_LOCALES.map((value) => ({ value, label: t(`generator.localeLabel.${value}`) }))}
        onChange={(value) => (locale = value)}
      />
    </span>
  </div>

  <div class="grid max-h-[220px] grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.6fr)] items-center gap-x-2 gap-y-1 overflow-y-auto">
    {#each table.fields as field (field.id)}
      {@const column = columns[field.id]}
      {#if column}
        <span class="truncate font-mono text-xs">
          {field.name}
          <span class="text-text-muted">{field.type}</span>
        </span>
        <Select
          size="sm"
          aria-label={t("generator.kindFor", { column: field.name })}
          value={column.kind}
          options={kindOptions}
          onChange={(kind) => setColumn(field.id, { kind })}
        />
        <span class="flex min-w-0 gap-1">
          {#if column.kind === "oneOf"}
            <input
              class={`${INPUT_SM_CLASS} w-full`}
              aria-label={t("generator.valuesFor", { column: field.name })}
              placeholder={t("generator.valuesPlaceholder")}
              value={(column.values ?? []).join(", ")}
              onchange={(event) =>
                setColumn(field.id, {
                  values: event.currentTarget.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  weights: undefined,
                })}
            />
          {:else if column.kind === "fixed"}
            <input
              class={`${INPUT_SM_CLASS} w-full`}
              aria-label={t("generator.valueFor", { column: field.name })}
              value={column.value ?? ""}
              onchange={(event) => setColumn(field.id, { value: event.currentTarget.value })}
            />
          {:else if needsRange(column.kind)}
            <input
              class={`${INPUT_SM_CLASS} w-1/2`}
              aria-label={t("generator.minFor", { column: field.name })}
              placeholder={t("generator.min")}
              value={column.min ?? ""}
              onchange={(event) => setColumn(field.id, { min: event.currentTarget.value })}
            />
            <input
              class={`${INPUT_SM_CLASS} w-1/2`}
              aria-label={t("generator.maxFor", { column: field.name })}
              placeholder={t("generator.max")}
              value={column.max ?? ""}
              onchange={(event) => setColumn(field.id, { max: event.currentTarget.value })}
            />
          {/if}
        </span>
      {/if}
    {/each}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" onclick={() => void generate.run()} disabled={busy}>
      {generate.pending ? t("common.loading") : t("generator.preview")}
    </Button>
    {#if run}
      <Button
        size="sm"
        variant="ghost"
        onclick={() => {
          seed += 1;
          void generate.run();
        }}
        disabled={busy}
        data-tooltip={t("generator.regenerateHint")}
      >
        <Icon icon={RestoreIcon} size={13} />
        {t("generator.regenerate")}
      </Button>
      <span class="flex-1"></span>
      <Button size="sm" variant="ghost" onclick={exportCsv} disabled={busy}>
        <Icon icon={DownloadIcon} size={13} />
        {t("generator.exportCsv")}
      </Button>
      {#if canEdit}
        <Button size="sm" variant="primary" onclick={() => void use.run()} disabled={busy || run.problems.length > 0}>
          {t("generator.use", { count: run.rowCount })}
        </Button>
      {/if}
    {/if}
  </div>
  {#if generate.error ?? use.error}<ErrorText>{generate.error ?? use.error}</ErrorText>{/if}

  {#if run && run.problems.length > 0}
    <ul class="text-xs text-danger" role="status">
      {#each run.problems as problem (problem.column)}
        <li>{problem.column} — {t(`generator.problem.${problem.reason}`)}</li>
      {/each}
    </ul>
  {/if}

  {#if preview && preview.length > 1}
    <div class="overflow-auto rounded-sm border border-border">
      <table class="w-full border-collapse font-mono text-xs" aria-label={t("generator.previewTable")}>
        <thead class="bg-surface-raised">
          <tr>
            {#each preview[0] as name, index (index)}
              <th class="border-b border-border px-2 py-1 text-left">{name}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each preview.slice(1) as row, r (r)}
            <tr>
              {#each row as value, c (c)}
                <td class="max-w-[200px] truncate px-2 py-0.5">{value === null ? "NULL" : value}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
