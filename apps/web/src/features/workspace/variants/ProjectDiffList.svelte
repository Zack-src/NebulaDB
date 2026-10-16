<script lang="ts">
  import type { Field } from "@nebuladb/shared";
  import type { ProjectDiff } from "@nebuladb/dbml-engine";
  import Badge from "@/components/ui/Badge.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Two versions of a schema side by side, as `diffProjects` matched them:
   * tables only one side has, and for the others the columns that differ,
   * with each side's definition. `left` and `right` name the two sides.
   */
  let { diff, left, right }: { diff: ProjectDiff; left: string; right: string } = $props();

  const { t } = useTranslation();
  const TONE = { added: "success", removed: "danger", changed: "warning" } as const;

  function describe(field: Field | undefined): string {
    if (!field) return "—";
    const flags = [field.pk && "pk", field.unique && "unique", field.notNull && "not null", field.increment && "increment"]
      .filter(Boolean)
      .join(", ");
    return `${field.type}${flags ? ` [${flags}]` : ""}${field.default !== undefined ? ` = ${field.default}` : ""}`;
  }

  const refsChanged = $derived(diff.refs.length);
</script>

{#if diff.tables.length === 0 && refsChanged === 0}
  <p class="m-0 rounded-md border border-border bg-surface p-4 text-center text-xs text-text-muted" data-testid="diff-empty">
    {t("variants.compare.same")}
  </p>
{:else}
  <div class="space-y-2" data-testid="project-diff">
    {#each diff.tables as table (table.id)}
      <div class="rounded-md border border-border bg-surface" data-testid="diff-table">
        <div class="flex items-center gap-2 px-3 py-2">
          <span class="font-mono text-xs font-semibold">{table.name}</span>
          {#if table.renamedFrom}
            <span class="text-[11px] text-text-muted">{t("variants.compare.renamedFrom", { name: table.renamedFrom })}</span>
          {/if}
          <Badge tone={TONE[table.status]} class="ml-auto">
            {t(
              table.status === "added"
                ? "variants.compare.onlyRight"
                : table.status === "removed"
                  ? "variants.compare.onlyLeft"
                  : "variants.compare.different",
              { left, right },
            )}
          </Badge>
        </div>
        {#if table.fields.length > 0}
          <table class="w-full border-t border-border text-[11px]">
            <thead class="text-left text-text-muted">
              <tr>
                <th class="px-3 py-1 font-medium">{t("variants.compare.column")}</th>
                <th class="px-3 py-1 font-medium">{left}</th>
                <th class="px-3 py-1 font-medium">{right}</th>
              </tr>
            </thead>
            <tbody>
              {#each table.fields as field (field.id)}
                <tr class="border-t border-border/60">
                  <td class="px-3 py-1 font-mono">{field.name}</td>
                  <td class={`px-3 py-1 font-mono ${field.status === "removed" ? "text-danger" : ""}`}>{describe(field.before)}</td>
                  <td class={`px-3 py-1 font-mono ${field.status === "added" ? "text-success" : ""}`}>{describe(field.after)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/each}
    {#if refsChanged > 0}
      <p class="m-0 text-xs text-text-muted">{t("variants.compare.refs", { count: refsChanged })}</p>
    {/if}
  </div>
{/if}
