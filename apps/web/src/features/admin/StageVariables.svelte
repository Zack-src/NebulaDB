<script lang="ts">
  import { VARIABLE_NAME, VARIABLE_VALUE, VARIABLES_MAX } from "@nebuladb/dbml-engine";
  import type { EnvironmentStage } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * One stage's variables as a name/value table. A row with an empty value is a
   * variable ("no prefix here"); a variable that is not in the table is not defined.
   * The names other stages define and this one lacks are listed as likely omissions.
   */
  const {
    stage,
    others,
    disabled,
    onSave,
  }: {
    stage: EnvironmentStage;
    others: EnvironmentStage[];
    disabled: boolean;
    onSave: (variables: Record<string, string>) => void;
  } = $props();
  const { t } = useTranslation();

  interface Row {
    key: number;
    name: string;
    value: string;
  }
  let nextKey = 0;
  const toRows = (variables: Record<string, string>): Row[] =>
    Object.entries(variables).map(([name, value]) => ({ key: nextKey++, name, value }));

  // The parent re-mounts this component when the saved variables change, so the draft starts from them.
  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(toRows(stage.variables));

  const nameError = (row: Row) => {
    const name = row.name.trim();
    if (!VARIABLE_NAME.test(name)) return t("environments.variableNameInvalid");
    if (rows.some((other) => other !== row && other.name.trim() === name)) return t("environments.variableNameDuplicate");
    return null;
  };
  const valueError = (row: Row) => (VARIABLE_VALUE.test(row.value) ? null : t("environments.variableValueInvalid"));

  const dirty = $derived(
    JSON.stringify(rows.map((row) => [row.name.trim(), row.value])) !== JSON.stringify(Object.entries(stage.variables)),
  );
  const invalid = $derived(rows.some((row) => nameError(row) || valueError(row)) || rows.length > VARIABLES_MAX);
  // Defined elsewhere but not here (saved state, not the draft): the likely omissions.
  const missing = $derived(
    [...new Set(others.flatMap((other) => Object.keys(other.variables)))]
      .filter((name) => !(name in stage.variables))
      .sort(),
  );

  const addRow = (name = "") => (rows = [...rows, { key: nextKey++, name, value: "" }]);

  function save() {
    if (invalid || !dirty) return;
    onSave(Object.fromEntries(rows.map((row) => [row.name.trim(), row.value])));
  }
</script>

<div
  class="mt-1 flex flex-col gap-2 rounded-sm border border-border bg-surface px-3 py-2.5"
  role="group"
  aria-label={t("environments.variablesLabel", { name: stage.name })}
>
  <Hint>{t("environments.variablesHint")}</Hint>
  {#if rows.length === 0}
    <p class="text-xs text-text-muted">{t("environments.variablesEmpty")}</p>
  {/if}
  {#each rows as row (row.key)}
    {@const nameProblem = nameError(row)}
    {@const valueProblem = valueError(row)}
    <div class="flex items-start gap-2">
      <div class="flex w-48 flex-col gap-1">
        <Input
          inputSize="sm"
          class="font-mono"
          bind:value={row.name}
          invalid={Boolean(nameProblem)}
          aria-invalid={Boolean(nameProblem)}
          aria-label={t("environments.variableName", { name: stage.name })}
          placeholder="table_prefix"
          {disabled}
        />
        {#if nameProblem}<span class="text-[11.5px] text-danger">{nameProblem}</span>{/if}
      </div>
      <span class="pt-1 font-mono text-xs text-text-muted">=</span>
      <div class="flex min-w-[160px] flex-1 flex-col gap-1">
        <Input
          inputSize="sm"
          class="font-mono"
          bind:value={row.value}
          invalid={Boolean(valueProblem)}
          aria-invalid={Boolean(valueProblem)}
          aria-label={t("environments.variableValue", { name: stage.name, variable: row.name.trim() })}
          {disabled}
          onkeydown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
        {#if valueProblem}<span class="text-[11.5px] text-danger">{valueProblem}</span>{/if}
      </div>
      <Button
        variant="ghost"
        size="icon"
        data-tooltip={t("common.delete")}
        aria-label={t("environments.variableRemove", { name: stage.name, variable: row.name.trim() })}
        {disabled}
        onclick={() => (rows = rows.filter((other) => other !== row))}
      >
        <Icon icon={TrashIcon} size={13} />
      </Button>
    </div>
  {/each}
  {#if rows.length > VARIABLES_MAX}
    <span class="text-[11.5px] text-danger">{t("environments.variablesTooMany", { max: VARIABLES_MAX })}</span>
  {/if}
  {#if missing.length > 0}
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-text-muted">{t("environments.variablesMissing", { name: stage.name })}</span>
      {#each missing as name (name)}
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-50"
          aria-label={t("environments.variableAddMissing", { variable: name })}
          disabled={disabled || rows.some((row) => row.name.trim() === name)}
          onclick={() => addRow(name)}
        >
          <Badge tone="warning" class="font-mono normal-case">{name}</Badge>
        </button>
      {/each}
    </div>
  {/if}
  <div class="flex items-center gap-2">
    <Button size="sm" variant="ghost" disabled={disabled || rows.length >= VARIABLES_MAX} onclick={() => addRow()}>
      <Icon icon={PlusIcon} size={12} />
      {t("environments.variableAdd")}
    </Button>
    <Button size="sm" variant="primary" disabled={disabled || !dirty || invalid} onclick={save}>
      {t("environments.variablesSave")}
    </Button>
  </div>
</div>
