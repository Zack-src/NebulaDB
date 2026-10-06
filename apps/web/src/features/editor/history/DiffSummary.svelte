<script lang="ts" module>
  import type { ChangeStatus } from "@nebuladb/dbml-engine";

  const DIFF_ROW_CLASS: Record<ChangeStatus, string> = {
    added: "text-success",
    removed: "text-danger",
    changed: "text-warning",
  };
  const DIFF_SIGN: Record<ChangeStatus, string> = { added: "+", removed: "-", changed: "~" };
</script>

<script lang="ts">
  import type { ProjectDiff } from "@nebuladb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { RestoreIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let {
    diff,
    onRestoreTable,
    disabled = false,
  }: {
    diff: ProjectDiff;
    /** Offered per table when present: put that one table back as it was in the revision. */
    onRestoreTable?: (tableId: string, tableName: string) => void;
    disabled?: boolean;
  } = $props();
  const { t } = useTranslation();
</script>

{#if diff.tables.length === 0 && diff.refs.length === 0}
  <div class="text-xs text-text-muted">{t("history.noChanges")}</div>
{:else}
  <div>
    {#each diff.tables as table (table.id)}
      <div class="group flex items-center gap-1.5">
        <div class={`min-w-0 flex-1 font-mono text-xs leading-relaxed ${DIFF_ROW_CLASS[table.status]}`}>
          {`${DIFF_SIGN[table.status]} Table ${table.renamedFrom ? `${table.renamedFrom} → ${table.name}` : table.name}`}{#if table.fields.length > 0}<span
              class="text-text-muted"
              >{` (${table.fields.map((field) => `${DIFF_SIGN[field.status]}${field.name}`).join(", ")})`}</span
            >{/if}
        </div>
        {#if onRestoreTable}
          <!-- The diff reads "revision → now", so restoring a table undoes its line. -->
          <button
            type="button"
            class="flex shrink-0 cursor-pointer items-center gap-1 rounded-xs border-0 bg-transparent px-1 py-px text-caption text-text-muted opacity-0 transition-opacity duration-fast hover:bg-surface-hover hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-default disabled:opacity-40"
            onclick={() => onRestoreTable(table.id, table.name)}
            {disabled}
            data-tooltip={t("history.restoreTableHint", { table: table.renamedFrom ?? table.name })}
          >
            <Icon icon={RestoreIcon} size={12} />
            {t("history.restoreTable")}
          </button>
        {/if}
      </div>
    {/each}
    {#each diff.refs as ref (ref.id)}
      {@const name = (ref.after ?? ref.before)?.name}
      <div class={`font-mono text-xs leading-relaxed ${DIFF_ROW_CLASS[ref.status]}`}>
        {`${DIFF_SIGN[ref.status]} Ref${name ? ` ${name}` : ""}`}
      </div>
    {/each}
  </div>
{/if}
