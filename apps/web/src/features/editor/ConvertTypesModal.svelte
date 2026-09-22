<script lang="ts" module>
  import type { DatabaseEngine } from "@athanordb/shared";

  const ENGINES: DatabaseEngine[] = ["postgres", "mysql", "mssql", "sqlite", "oracle"];

  interface TypeChange {
    key: string;
    tableId: string;
    tableName: string;
    fieldId: string;
    fieldName: string;
    from: string;
    to: string;
  }
</script>

<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { translateType, type Project } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { SELECT_CLASS, CHECKBOX_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Project-wide "convert column types" action — walks every field currently
   * on the canvas and offers to rewrite the ones `translateType` (see
   * `@athanordb/shared/typeMapping`) finds incompatible with a chosen target
   * engine, the same logic the deploy/export type-translation risk uses. This
   * is a plain, one-off canvas edit: it goes through `convertFieldTypes` (a
   * single Yjs transaction, same shape as `setTablesColor`), not the
   * deploy/export flow, so there's no live database involved and no
   * confirmation wizard beyond this dialog's own preview + checkboxes.
   */
  let props: {
    project: Project;
    onApply: (changes: { tableId: string; fieldId: string; newType: string }[]) => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let targetEngine = $state<DatabaseEngine>("postgres");
  const excluded = new SvelteSet<string>();

  const changes = $derived.by(() => {
    const result: TypeChange[] = [];
    for (const table of props.project.tables) {
      for (const field of table.fields) {
        const translation = translateType(field.type, targetEngine);
        if (!translation.changed) continue;
        result.push({
          key: `${table.id}:${field.id}`,
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          from: field.type,
          to: translation.type,
        });
      }
    }
    return result;
  });

  // Excluding by key means switching the target engine (which reshuffles which
  // fields even show up) never leaves a stale exclusion silently suppressing an
  // unrelated row — a key not present in the new `changes` list is simply inert.
  const selected = $derived(changes.filter((c) => !excluded.has(c.key)));

  function toggle(key: string) {
    if (excluded.has(key)) excluded.delete(key);
    else excluded.add(key);
  }

  function apply() {
    props.onApply(selected.map((c) => ({ tableId: c.tableId, fieldId: c.fieldId, newType: c.to })));
    props.onClose();
  }
</script>

<Modal title={t("convertTypes.title")} onClose={props.onClose}>
  <div class="space-y-3">
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="mb-1 block text-xs font-medium text-text-muted">{t("convertTypes.targetEngine")}</label>
      <select
        class={SELECT_CLASS}
        value={targetEngine}
        onchange={(e) => {
          targetEngine = e.currentTarget.value as DatabaseEngine;
          excluded.clear();
        }}
      >
        {#each ENGINES as engine (engine)}
          <option value={engine}>{t(`connections.engine.${engine}` as const)}</option>
        {/each}
      </select>
    </div>

    {#if changes.length === 0}
      <Hint>{t("convertTypes.noChanges")}</Hint>
    {:else}
      <Hint>{t("convertTypes.previewHint", { count: changes.length })}</Hint>
      <div class="max-h-72 space-y-1 overflow-y-auto rounded-sm border border-border bg-surface p-2">
        {#each changes as c (c.key)}
          <label class="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-surface-hover">
            <input type="checkbox" class={CHECKBOX_CLASS} checked={!excluded.has(c.key)} onchange={() => toggle(c.key)} />
            <span class="font-mono text-text">{c.tableName}.{c.fieldName}</span>
            <span class="font-mono text-text-muted">{c.from} → {c.to}</span>
          </label>
        {/each}
      </div>
    {/if}

    <div class="flex justify-end gap-2 pt-1">
      <Button variant="ghost" onclick={props.onClose}>
        {t("common.cancel")}
      </Button>
      <Button variant="primary" onclick={apply} disabled={selected.length === 0}>
        {t("convertTypes.apply", { count: selected.length })}
      </Button>
    </div>
  </div>
</Modal>
