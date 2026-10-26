<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import type { ConflictResolutionStrategy, MigrationResolutionMap, SchemaRisk } from "@nebuladb/shared";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon, CheckCircleIcon, CodeIcon, InfoIcon, TableIcon } from "@/components/icons/Icons";
  import RadioGroup from "@/components/ui/RadioGroup.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import AnalyzingNotice from "./AnalyzingNotice.svelte";
  import { riskKey } from "./deploymentModel";

  /**
   * Second step of the deployment dialog: each risk the plan found on the
   * live data, what was measured, and the strategy chosen to resolve it. The
   * dialog keeps the answers; this reports each change through
   * `onStrategyChange`.
   */
  let {
    risks,
    resolutions,
    onStrategyChange,
    analyzing = false,
    onShowInGraph,
    onShowInCode,
    tableExists = () => true,
  }: {
    risks: SchemaRisk[];
    resolutions: MigrationResolutionMap;
    onStrategyChange: (risk: SchemaRisk, strategy: ConflictResolutionStrategy, value?: string) => void;
    /** The plan is still being analysed: `risks` is not an answer yet, so no verdict is shown. */
    analyzing?: boolean;
    /** Centres the diagram on the table (and column) a conflict names. Absent where there is no diagram beside the panel. */
    onShowInGraph?: (tableName: string, fieldName?: string) => void;
    /** Scrolls the DBML code to the table a conflict names. */
    onShowInCode?: (tableName: string) => void;
    /** Whether the diagram has this table: a table only the database holds has nothing to show. */
    tableExists?: (tableName: string) => boolean;
  } = $props();

  const { t } = useTranslation();
  const uid = $props.id();

  /** The risks that can be settled by deleting the data: the ones a single click below can answer. */
  const droppable = $derived(
    risks.filter(
      (risk) =>
        risk.severity !== "info" &&
        risk.type !== "TYPE_TRANSLATION_SUGGESTED" &&
        risk.availableStrategies.some((option) => option.key === "DROP_DATA_CONFIRMED"),
    ),
  );
  const allDropped = $derived(
    droppable.length > 0 && droppable.every((risk) => resolutions[riskKey(risk)]?.strategy === "DROP_DATA_CONFIRMED"),
  );
</script>

<!-- Step 2: Risk and Conflict Resolution -->
<div class="space-y-4">
  {#if analyzing}
    <AnalyzingNotice title={t("deployment.analyzing")} detail={t("deployment.analyzingRisks")} />
  {:else if risks.length === 0}
    <div class="rounded-sm border border-emerald-500/20 bg-emerald-500/10 p-4 text-center text-xs text-emerald-400">
      <Icon icon={CheckCircleIcon} size={20} class="mx-auto mb-1.5" />
      <p class="font-semibold">{t("deployment.noRisksDetected")}</p>
      <p class="mt-0.5 text-text-muted">{t("deployment.noRisksDesc")}</p>
    </div>
  {:else}
    {#if droppable.length > 1}
      <!-- Only picks the answer on each risk: nothing is deleted until the deployment itself is confirmed. -->
      <div class="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-raised p-2.5">
        <p class="m-0 text-caption text-text-muted">{t("deployment.dropAllHint")}</p>
        <Button
          size="xs"
          variant="danger"
          class="self-start"
          disabled={allDropped}
          onclick={() => droppable.forEach((risk) => onStrategyChange(risk, "DROP_DATA_CONFIRMED"))}
        >
          {t("deployment.dropAll", { count: droppable.length })}
        </Button>
      </div>
    {/if}
    <div class="space-y-3">
      {#each risks as risk, index (risk.id)}
        {@const currentRes = resolutions[riskKey(risk)]}
        <div
          class={`rounded-sm border p-3 text-xs ${
            risk.severity === "critical"
              ? "border-rose-500/40 bg-rose-500/5"
              : risk.severity === "info"
                ? "border-border bg-surface"
                : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div class="flex items-start gap-2.5">
            <!-- As tall as the first line of the title, so the icon sits on its centre. -->
            <span class="flex h-5 w-4 flex-none items-center justify-center">
              <Icon
                icon={risk.severity === "info" ? InfoIcon : AlertTriangleIcon}
                size={16}
                class={risk.severity === "critical"
                  ? "text-rose-400"
                  : risk.severity === "info"
                    ? "text-primary"
                    : "text-amber-400"}
              />
            </span>
            <div class="flex-1 space-y-2">
              <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <h4 class="m-0 min-w-0 flex-1 basis-48 text-body font-bold leading-5 text-text">
                  {#if risk.type === "DROP_COLUMN_WITH_DATA"}
                    <span>{t("deployment.riskDropColumn", { col: risk.columnName || "", table: risk.tableName })}</span>
                  {/if}
                  {#if risk.type === "DROP_TABLE_WITH_DATA"}
                    <span>{t("deployment.riskDropTable", { table: risk.tableName })}</span>
                  {/if}
                  {#if risk.type === "UNMANAGED_TABLE"}
                    <span>{t("deployment.riskUnmanagedTable", { table: risk.tableName })}</span>
                  {/if}
                  {#if risk.type === "ALTER_COLUMN_TYPE"}
                    <span>{t("deployment.riskAlterType", { col: risk.columnName || "", table: risk.tableName })}</span>
                  {/if}
                  {#if risk.type === "NULL_TO_NOT_NULL"}
                    <span>
                      {t("deployment.riskNullViolation", { col: risk.columnName || "", table: risk.tableName })}
                    </span>
                  {/if}
                  {#if risk.type === "ADD_NOT_NULL_NO_DEFAULT"}
                    <span>{t("deployment.riskAddNotNull", { col: risk.columnName || "", table: risk.tableName })}</span>
                  {/if}
                  {#if risk.type === "LENGTH_REDUCTION"}
                    <span>
                      {t("deployment.riskLengthReduction", {
                        col: risk.columnName || "",
                        table: risk.tableName,
                        limit: risk.limit ?? 0,
                      })}
                    </span>
                  {/if}
                  {#if risk.type === "UNIQUE_VIOLATION"}
                    <span>{t("deployment.riskUnique", { cols: risk.detail || risk.columnName || "", table: risk.tableName })}</span>
                  {/if}
                  {#if risk.type === "FK_VIOLATION"}
                    <span>{t("deployment.riskForeignKey", { ref: risk.detail || "" })}</span>
                  {/if}
                  {#if risk.type === "TYPE_TRANSLATION_SUGGESTED"}
                    <span>
                      {t("deployment.riskTypeTranslation", { col: risk.columnName || "", table: risk.tableName })}
                      {#if risk.suggestedValue}
                        <span class="ml-1 font-mono font-normal text-text-muted">({risk.suggestedValue})</span>
                      {/if}
                    </span>
                  {/if}
                </h4>
                {#if risk.type !== "TYPE_TRANSLATION_SUGGESTED"}
                <Badge tone={risk.severity === "critical" ? "danger" : risk.severity === "info" ? "muted" : "warning"}>
                  {#if risk.unmeasured}
                    {t("deployment.riskUnmeasured")}
                  {:else if risk.type === "LENGTH_REDUCTION"}
                    {t("deployment.riskLongest", { max: risk.measuredMax ?? 0, limit: risk.limit ?? 0 })}
                  {:else}
                    {risk.affectedRowCount}
                    {t("deployment.rowsAffected")}
                  {/if}
                </Badge>
                {/if}
              </div>

              {#if (onShowInGraph || onShowInCode) && risk.tableName && tableExists(risk.tableName)}
                <div class="flex flex-wrap gap-1.5">
                  {#if onShowInGraph}
                    <Button size="xs" variant="ghost" onclick={() => onShowInGraph(risk.tableName, risk.columnName)}>
                      <Icon icon={TableIcon} size={12} />
                      {t("deployment.showInGraph")}
                    </Button>
                  {/if}
                  {#if onShowInCode}
                    <Button size="xs" variant="ghost" onclick={() => onShowInCode(risk.tableName)}>
                      <Icon icon={CodeIcon} size={12} />
                      {t("deployment.showInCode")}
                    </Button>
                  {/if}
                </div>
              {/if}

              <!-- Strategy selector radio group — nothing to decide for a check that passed -->
              {#if risk.type === "TYPE_TRANSLATION_SUGGESTED"}
                <!-- Nothing was measured and nothing is asked: the translated type is in the title. -->
              {:else if risk.severity === "info"}
                <p class="text-text-muted">{t("deployment.riskFits")}</p>
              {:else}
                <div class="space-y-1.5 pt-1">
                  <span id={`${uid}-strategy-${index}`} class="block font-semibold text-text">
                    {t("deployment.selectStrategy")}:
                  </span>
                  <RadioGroup
                    value={currentRes?.strategy}
                    options={risk.availableStrategies.map((opt) => ({
                      value: opt.key,
                      label: t(opt.labelKey as TranslationKeyOf),
                      hint: t(opt.descriptionKey as TranslationKeyOf),
                    }))}
                    onChange={(strategy) => onStrategyChange(risk, strategy)}
                    aria-labelledby={`${uid}-strategy-${index}`}
                  />

                  <!-- Optional default value input if strategy requires it -->
                  {#if currentRes?.strategy === "BACKFILL_DEFAULT"}
                    <div class="pt-1.5">
                      <!-- svelte-ignore a11y_label_has_associated_control -->
                      <label class="mb-1 block text-caption font-medium text-text">
                        {t("deployment.enterDefaultValue")}
                      </label>
                      <Input
                       
                        value={currentRes.value ?? ""}
                        oninput={(e) => onStrategyChange(risk, "BACKFILL_DEFAULT", e.currentTarget.value)}
                        placeholder="ex: 'default_value' or 0"
                      />
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
