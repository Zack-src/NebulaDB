<script lang="ts">
  import type { DatabaseEngine, DbRowCell, DbRowEditColumn } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { KeyIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Select from "@/components/ui/Select.svelte";
  import TextArea from "@/components/ui/TextArea.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { cellProblem } from "./rowEdits";

  /**
   * One row of the explorer's grid, as a form: a typed field per column. For
   * an existing row the fields start at its values (changes not applied yet
   * included); for a new one they start untouched — left so, a column takes
   * its default. Nothing is sent from here: saving adds to the pending changes.
   */
  let {
    engine,
    columns,
    values,
    locked,
    isNew,
    deleted = false,
    focusColumn = null,
    onSave,
    onToggleDelete,
    onClose,
  }: {
    engine: DatabaseEngine;
    columns: DbRowEditColumn[];
    /** By column name. `undefined` (a new row only): left to the default. */
    values: Record<string, DbRowCell | undefined>;
    /** Columns of this row that are shown but not edited here (a value not shown whole). */
    locked: ReadonlySet<string>;
    isNew: boolean;
    deleted?: boolean;
    focusColumn?: string | null;
    onSave: (values: Record<string, DbRowCell | undefined>) => void;
    /** Deletes the row (or takes it out, a new one) — or takes a deletion back. */
    onToggleDelete: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  // svelte-ignore state_referenced_locally
  let draft = $state<Record<string, DbRowCell | undefined>>({ ...values });

  const LONG_TEXT = 60;
  const NULL_LABEL = "NULL";
  /** Decided once from the starting values: a field must not change element (and lose focus) while typed in. */
  // svelte-ignore state_referenced_locally
  const multiline = new Set(
    columns
      .filter((c) => c.kind === "json" || (values[c.name] ?? "").length > LONG_TEXT || (values[c.name] ?? "").includes("\n"))
      .map((c) => c.name),
  );

  function lockReason(column: DbRowEditColumn): string | null {
    if (column.readOnly) return t(`dbadmin.rows.lock.${column.readOnly}`);
    if (locked.has(column.name)) return t("dbadmin.rows.lock.partial");
    return null;
  }

  const problems = $derived(
    Object.fromEntries(
      columns.map((column) => {
        const value = draft[column.name];
        if (lockReason(column) || value === undefined) return [column.name, null];
        return [column.name, cellProblem(column, value, engine)];
      }),
    ),
  );
  const blocked = $derived(Object.values(problems).some((problem) => problem !== null));

  function booleanOptions(column: DbRowEditColumn, current: DbRowCell | undefined) {
    const [yes, no] = column.booleanValues ?? ["true", "false"];
    const options = [
      { value: yes, label: `${t("dbadmin.rows.true")} (${yes})` },
      { value: no, label: `${t("dbadmin.rows.false")} (${no})` },
    ];
    // A value the engine accepted but that is neither (a 2 in a MySQL TINYINT(1)) is still offered as is.
    if (typeof current === "string" && current !== yes && current !== no) options.push({ value: current, label: current });
    return options;
  }

  function save() {
    if (blocked) return;
    onSave($state.snapshot(draft));
  }
</script>

<Modal title={isNew ? t("dbadmin.rows.newRowTitle") : t("dbadmin.rows.editRowTitle")} {onClose} wide>
  <div class="max-h-[60vh] space-y-3 overflow-y-auto pr-1" data-testid="row-editor">
    {#each columns as column (column.name)}
      {@const value = draft[column.name]}
      {@const reason = lockReason(column)}
      {@const problem = problems[column.name]}
      <div class="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-3">
        <div class="min-w-0 pt-1">
          <div class="flex items-center gap-1 truncate font-mono text-xs font-semibold text-text" title={column.name}>
            {#if column.primaryKey}<Icon icon={KeyIcon} size={11} class="shrink-0 text-warning" />{/if}
            {column.name}
          </div>
          <div class="truncate font-mono text-caption text-text-muted" title={column.type}>{column.type}</div>
        </div>
        <div class="min-w-0">
          {#if reason}
            <div class="truncate rounded-sm bg-surface-raised px-2 py-1 font-mono text-xs text-text-muted" title={value ?? ""}>
              {#if value === null}<span class="italic">{NULL_LABEL}</span>{:else if value === undefined}<span class="italic">{t("dbadmin.rows.default")}</span>{:else}{value}{/if}
            </div>
            <p class="mt-0.5 text-caption text-text-muted">{reason}</p>
          {:else}
            <div class="flex items-start gap-1.5">
              <div class="min-w-0 flex-1">
                {#if value === null}
                  <div class="rounded-sm border border-dashed border-border px-2 py-1 font-mono text-xs text-text-muted italic">{NULL_LABEL}</div>
                {:else if column.kind === "boolean"}
                  <Select
                    size="sm"
                    class="w-full"
                    value={value ?? ""}
                    options={booleanOptions(column, value)}
                    placeholder={value === undefined ? t("dbadmin.rows.default") : undefined}
                    onChange={(next) => (draft[column.name] = next)}
                    aria-label={column.name}
                  />
                {:else if multiline.has(column.name)}
                  <TextArea
                    class="w-full font-mono text-xs"
                    autoGrow
                    rows={2}
                    value={value ?? ""}
                    placeholder={value === undefined ? t("dbadmin.rows.default") : ""}
                    invalid={problem !== null}
                    aria-label={column.name}
                    oninput={(event: Event) => (draft[column.name] = (event.currentTarget as HTMLTextAreaElement).value)}
                  />
                {:else}
                  <Input
                    inputSize="sm"
                    class="w-full font-mono"
                    value={value ?? ""}
                    placeholder={value === undefined
                      ? t(column.hasDefault ? "dbadmin.rows.default" : "dbadmin.rows.noDefault")
                      : column.kind === "datetime"
                        ? t("dbadmin.rows.datetimeHint")
                        : ""}
                    inputmode={["integer", "decimal", "float"].includes(column.kind) ? "decimal" : undefined}
                    invalid={problem !== null}
                    autofocus={focusColumn === column.name}
                    aria-label={column.name}
                    oninput={(event: Event) => (draft[column.name] = (event.currentTarget as HTMLInputElement).value)}
                  />
                {/if}
              </div>
              {#if value === null}
                <Button variant="ghost" size="sm" onclick={() => (draft[column.name] = "")}>{t("dbadmin.rows.enterValue")}</Button>
              {:else if column.nullable}
                <Button variant="ghost" size="sm" data-tooltip={t("dbadmin.rows.setNullHint")} onclick={() => (draft[column.name] = null)}
                  >{t("dbadmin.rows.setNull")}</Button
                >
              {/if}
              {#if isNew && value !== undefined}
                <Button variant="ghost" size="sm" onclick={() => (draft[column.name] = undefined)}>{t("dbadmin.rows.useDefault")}</Button>
              {/if}
            </div>
            {#if problem}
              <p class="mt-0.5 text-caption text-danger">{t(`dbadmin.rows.problem.${problem}`)}</p>
            {:else if isNew && value === undefined && !column.hasDefault && !column.nullable}
              <p class="mt-0.5 text-caption text-warning">{t("dbadmin.rows.requiredHint")}</p>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
  <Hint>{t("dbadmin.rows.editorHint")}</Hint>

  <div class="mt-4 flex items-center justify-between gap-2">
    <Button variant="danger-ghost" size="sm" onclick={onToggleDelete}>
      {isNew ? t("dbadmin.rows.removeNew") : deleted ? t("dbadmin.rows.undelete") : t("dbadmin.rows.delete")}
    </Button>
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="sm" onclick={onClose}>{t("common.cancel")}</Button>
      <Button variant="primary" size="sm" disabled={blocked || deleted} onclick={save}>{t("dbadmin.rows.keep")}</Button>
    </div>
  </div>
</Modal>
