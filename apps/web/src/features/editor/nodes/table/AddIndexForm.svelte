<script lang="ts">
  import type { Table } from "@athanordb/shared";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { POPOVER_INPUT_CLASS, POPOVER_LABEL_CLASS } from "@/features/editor/nodes/table/tableStyles";
  import type { IndexOptions } from "./TableSettingsPopover.svelte";

  /**
   * Add-index mini-form: pick 2+ columns (one is just "make this field
   * pk/unique", already covered by the column popover), unique/pk, an optional
   * name.
   */
  let {
    table,
    onAdd,
    onCancel,
  }: { table: Table; onAdd: (fieldIds: string[], options: IndexOptions) => void; onCancel: () => void } = $props();

  const { t } = useTranslation();
  let selectedFieldIds = $state.raw<string[]>([]);
  let unique = $state(false);
  let primaryKey = $state(false);
  let indexName = $state("");

  function toggleField(id: string) {
    selectedFieldIds = selectedFieldIds.includes(id)
      ? selectedFieldIds.filter((f) => f !== id)
      : [...selectedFieldIds, id];
  }

  function submit() {
    if (selectedFieldIds.length === 0) return;
    onAdd(selectedFieldIds, {
      unique: unique || undefined,
      pk: primaryKey || undefined,
      name: indexName.trim() || undefined,
    });
    onCancel();
  }
</script>

<div class="flex flex-col gap-2 rounded-md border border-border-strong/80 bg-surface p-2.5">
  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label class={POPOVER_LABEL_CLASS}>{t("table.index.columns")}</label>
  <div class="flex max-h-32 flex-col gap-1 overflow-y-auto">
    {#each table.fields as field (field.id)}
      <label class="flex items-center gap-1.5 text-xs text-text">
        <input
          type="checkbox"
          class="accent-primary"
          checked={selectedFieldIds.includes(field.id)}
          onchange={() => toggleField(field.id)}
        />
        <span class="font-mono">{field.name}</span>
      </label>
    {/each}
  </div>
  <div class="flex gap-3">
    <label class="flex items-center gap-1.5 text-xs text-text">
      <input type="checkbox" class="accent-primary" bind:checked={unique} />
      {t("field.unique")}
    </label>
    <label class="flex items-center gap-1.5 text-xs text-text">
      <input type="checkbox" class="accent-primary" bind:checked={primaryKey} />
      {t("field.primaryKey")}
    </label>
  </div>
  <input class={POPOVER_INPUT_CLASS} bind:value={indexName} placeholder={t("table.index.namePlaceholder")} />
  <div class="flex justify-end gap-2">
    <Button variant="ghost" size="sm" onclick={onCancel}>{t("common.cancel")}</Button>
    <Button variant="primary" size="sm" disabled={selectedFieldIds.length === 0} onclick={submit}>
      {t("common.create")}
    </Button>
  </div>
</div>
