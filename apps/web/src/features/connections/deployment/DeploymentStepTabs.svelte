<script lang="ts">
  import Badge from "@/components/ui/Badge.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { DeploymentStep } from "./deploymentModel";

  /**
   * The tab bar of the deployment dialog: one tab per step, with the number
   * of changed tables and of risks, and a "done" tab once a deployment went
   * through. The dialog owns the active step; this only shows and sets it.
   */
  let {
    activeStep = $bindable(),
    tableCount,
    riskCount,
    hasResult,
  }: {
    activeStep: DeploymentStep;
    /** Tables in the diff — left out while there is no plan. */
    tableCount?: number;
    riskCount: number;
    hasResult: boolean;
  } = $props();

  const { t } = useTranslation();

  const TAB = "border-b-2 px-3 py-2 font-medium transition-colors";
  const tabState = (step: DeploymentStep) =>
    activeStep === step ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text";
</script>

<div class="flex border-b border-border text-xs">
  <button type="button" class={`${TAB} ${tabState("diff")}`} onclick={() => (activeStep = "diff")}>
    {t("deployment.stepDiff")}
    {tableCount !== undefined ? `(${tableCount})` : ""}
  </button>
  <button
    type="button"
    class={`flex items-center gap-1.5 ${TAB} ${tabState("risks")}`}
    onclick={() => (activeStep = "risks")}
  >
    <span>{t("deployment.stepRisks")}</span>
    {#if riskCount > 0}<Badge tone="warning">{riskCount}</Badge>{/if}
  </button>
  <button type="button" class={`${TAB} ${tabState("sql")}`} onclick={() => (activeStep = "sql")}>
    {t("deployment.stepSql")}
  </button>
  <button type="button" class={`${TAB} ${tabState("history")}`} onclick={() => (activeStep = "history")}>
    {t("deployment.stepHistory")}
  </button>
  {#if hasResult}
    <button
      type="button"
      class={`border-b-2 px-3 py-2 font-medium text-emerald-400 ${
        activeStep === "done" ? "border-emerald-400" : "border-transparent"
      }`}
      onclick={() => (activeStep = "done")}
    >
      {t("deployment.stepDone")}
    </button>
  {/if}
</div>
