<script lang="ts" module>
  import type { ChangeStatus } from "@athanordb/dbml-engine";

  const DIFF_ROW_CLASS: Record<ChangeStatus, string> = {
    added: "text-success",
    removed: "text-danger",
    changed: "text-warning",
  };
  const DIFF_SIGN: Record<ChangeStatus, string> = { added: "+", removed: "-", changed: "~" };
</script>

<script lang="ts">
  import type { ProjectDiff } from "@athanordb/dbml-engine";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let { diff }: { diff: ProjectDiff } = $props();
  const { t } = useTranslation();
</script>

{#if diff.tables.length === 0 && diff.refs.length === 0}
  <div class="text-xs text-text-muted">{t("history.noChanges")}</div>
{:else}
  <div>
    {#each diff.tables as table (table.id)}
      <div class={`font-mono text-xs leading-relaxed ${DIFF_ROW_CLASS[table.status]}`}>
        {`${DIFF_SIGN[table.status]} Table ${table.renamedFrom ? `${table.renamedFrom} → ${table.name}` : table.name}`}{#if table.fields.length > 0}<span
            class="text-text-muted"
            >{` (${table.fields.map((field) => `${DIFF_SIGN[field.status]}${field.name}`).join(", ")})`}</span
          >{/if}
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
