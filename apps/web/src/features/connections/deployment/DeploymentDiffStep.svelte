<script lang="ts">
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckCircleIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { PlanDeploymentResponse } from "@/services/connectionsApi";

  /**
   * First step of the deployment dialog: what differs between the schema and
   * the database, table by table, then what would refuse the deployment
   * (lint errors, an earlier pipeline stage) and what the tables' initial
   * data would do after the DDL.
   */
  let {
    plan,
    analyzing,
    readOnly,
    canSkipStage,
    seedsToInsert,
    skipSeeds = $bindable(),
    onShowProblems,
  }: {
    plan: PlanDeploymentResponse | null;
    analyzing: boolean;
    readOnly: boolean;
    canSkipStage: boolean;
    /** Seeds would be inserted: an unchanged schema is then not "in sync". */
    seedsToInsert: boolean;
    /** Leave the tables' initial data out of this deployment. */
    skipSeeds: boolean;
    onShowProblems?: () => void;
  } = $props();

  const { t } = useTranslation();
  const diff = $derived(plan?.diff);
  const seedPlan = $derived(plan?.seeds ?? []);
</script>

<!-- Step 1: Schema Diff View -->
<div class="space-y-3">
  {#if analyzing}
    <div class="flex h-48 items-center justify-center text-xs text-text-muted">
      {t("deployment.analyzingDiff")}
    </div>
  {:else if !diff?.hasChanges && !seedsToInsert}
    <div class="rounded-sm border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
      <Icon icon={CheckCircleIcon} size={24} class="mx-auto mb-2 text-emerald-400" />
      <p class="font-semibold text-text">{t("deployment.inSync")}</p>
      <p class="mt-1">{t("deployment.inSyncDesc")}</p>
    </div>
  {:else if diff}
    <div class="max-h-80 space-y-2 overflow-y-auto pr-1">
      {#each diff.tables as table (table.name)}
        <div class="rounded-sm border border-border bg-surface p-2.5 text-xs">
          <div class="flex items-center justify-between pb-1">
            <span class="font-mono font-bold text-text">
              {#if table.status === "added"}<span class="text-emerald-400">+ </span>{/if}
              {#if table.status === "dropped"}<span class="text-rose-400">- </span>{/if}
              {#if table.status === "modified"}<span class="text-amber-400">~ </span>{/if}
              {table.name}
            </span>
            <Badge tone={table.status === "added" ? "admin" : table.status === "dropped" ? "danger" : "warning"}>
              {table.status}
            </Badge>
          </div>

          {#if table.fields.length > 0}
            <div class="mt-1.5 space-y-1 border-t border-border/50 pl-2 pt-1 font-mono text-[11px]">
              {#each table.fields as f (f.name)}
                <div class="flex items-center justify-between text-text-muted">
                  <div>
                    {#if f.status === "added"}<span class="text-emerald-400">+ </span>{/if}
                    {#if f.status === "dropped"}<span class="text-rose-400">- </span>{/if}
                    {#if f.status === "modified"}<span class="text-amber-400">~ </span>{/if}
                    <span>{f.name}</span>
                    {#if f.typeChanged}
                      <span class="text-text"> ({f.before?.type} → {f.after?.type})</span>
                    {/if}
                    {#if f.notNullChanged}
                      <span class="text-amber-400"> [{f.after?.notNull ? "NOT NULL" : "NULL"}]</span>
                    {/if}
                  </div>
                  <span class="text-[10px] text-text-muted">{f.status}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- The tables' initial data, inserted after the DDL -->
{#if !analyzing && !readOnly && plan}
  {#if plan.blockers.lintErrors > 0}
    <div
      class="mb-2 rounded-md border border-danger bg-danger-light px-3 py-2 text-xs text-danger"
      role="alert"
      data-testid="lint-blockers"
    >
      <p class="m-0">{t("deployment.blockedByLint", { count: plan.blockers.lintErrors })}</p>
      <ul class="m-0 mt-1.5 list-disc pl-4">
        {#each plan.blockers.lintFindings as finding (`${finding.ruleId}:${finding.tableName}:${finding.fieldName ?? ""}`)}
          <li>
            <span class="font-mono font-semibold">{finding.tableName}</span>
            — {t(`lint.rule.${finding.ruleId}.message` as "lint.rule.pk-required.message", finding.params)}
          </li>
        {/each}
      </ul>
      {#if plan.blockers.lintErrors > plan.blockers.lintFindings.length}
        <p class="m-0 mt-1">
          {t("deployment.blockedByLintMore", {
            count: plan.blockers.lintErrors - plan.blockers.lintFindings.length,
          })}
        </p>
      {/if}
      {#if onShowProblems}
        <Button size="sm" variant="outline" class="mt-2" onclick={onShowProblems}>
          {t("deployment.showProblems")}
        </Button>
      {/if}
    </div>
  {/if}
  {#if plan.blockers.waitsForStage}
    <p
      class="m-0 mb-2 rounded-md border border-warning bg-warning-light px-3 py-2 text-xs text-warning"
      role="alert"
    >
      {canSkipStage
        ? t("deployment.waitsForStageAdmin", { stage: plan.blockers.waitsForStage })
        : t("deployment.waitsForStage", { stage: plan.blockers.waitsForStage })}
    </p>
  {/if}
{/if}
{#if !analyzing && seedPlan.length > 0}
  <div class="mt-3 rounded-sm border border-border bg-surface p-2.5 text-xs" data-testid="seed-plan">
    <div class="mb-1.5 flex items-center justify-between gap-2">
      <span class="font-semibold text-text">{t("seeds.planTitle")}</span>
      {#if !readOnly}
        <Checkbox bind:checked={skipSeeds}><span class="text-xs">{t("seeds.skip")}</span></Checkbox>
      {/if}
    </div>
    <ul class={`space-y-0.5 font-mono text-[11px] ${skipSeeds ? "opacity-50" : ""}`}>
      {#each seedPlan as entry (entry.tableId)}
        <li class={entry.errors > 0 ? "text-danger" : entry.action === "insert" ? "text-emerald-400" : "text-text-muted"}>
          {entry.tableName} :
          {#if entry.errors > 0}
            {t("seeds.planErrors", { count: entry.errors })}
          {:else if entry.action === "insert"}
            {t("seeds.planInsert", { count: entry.rows })}
          {:else if entry.action === "skip-not-empty"}
            {t("seeds.planSkip", { count: entry.existingRows ?? 0 })}
          {:else}
            {t("seeds.planUnmeasured")}
          {/if}
          {#if entry.errors === 0 && entry.warnings > 0}
            <span class="text-warning" data-seed-warnings={entry.tableName}>
              · {t("seeds.planWarnings", { count: entry.warnings })}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
    {#each plan?.seedCycles ?? [] as cycle, index (index)}
      <p class="mt-1 text-danger">{t("seeds.planCycle", { tables: cycle.join(" → ") })}</p>
    {/each}
  </div>
{/if}
