<script lang="ts">
  import type { ConflictResolutionStrategy, MigrationResolutionMap, SchemaRisk } from "@athanordb/shared";
  import Badge from "@/components/ui/Badge.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon, CheckCircleIcon } from "@/components/icons/Icons";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import RadioGroup from "@/components/ui/RadioGroup.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
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
  }: {
    risks: SchemaRisk[];
    resolutions: MigrationResolutionMap;
    onStrategyChange: (risk: SchemaRisk, strategy: ConflictResolutionStrategy, value?: string) => void;
  } = $props();

  const { t } = useTranslation();
  const uid = $props.id();
</script>

<!-- Step 2: Risk and Conflict Resolution -->
<div class="space-y-4">
  {#if risks.length === 0}
    <div class="rounded-sm border border-emerald-500/20 bg-emerald-500/10 p-4 text-center text-xs text-emerald-400">
      <Icon icon={CheckCircleIcon} size={20} class="mx-auto mb-1.5" />
      <p class="font-semibold">{t("deployment.noRisksDetected")}</p>
      <p class="mt-0.5 text-text-muted">{t("deployment.noRisksDesc")}</p>
    </div>
  {:else}
    <div class="max-h-84 space-y-3 overflow-y-auto pr-1">
      {#each risks as risk, index (risk.id)}
        {@const currentRes = resolutions[riskKey(risk)]}
        <div
          class={`rounded-sm border p-3.5 text-xs ${
            risk.severity === "critical"
              ? "border-rose-500/40 bg-rose-500/5"
              : risk.severity === "info"
                ? "border-border bg-surface"
                : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div class="flex items-start gap-2.5">
            <Icon
              icon={AlertTriangleIcon}
              size={16}
              class={risk.severity === "critical" ? "text-rose-400" : risk.severity === "info" ? "text-text-muted" : "text-amber-400"}
            />
            <div class="flex-1 space-y-2">
              <div class="flex items-center justify-between">
                <h4 class="font-bold text-text">
                  {#if risk.type === "DROP_COLUMN_WITH_DATA"}
                    <span>{t("deployment.riskDropColumn", { col: risk.columnName || "", table: risk.tableName })}</span>
                  {/if}
                  {#if risk.type === "DROP_TABLE_WITH_DATA"}
                    <span>{t("deployment.riskDropTable", { table: risk.tableName })}</span>
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
              </div>

              <!-- Strategy selector radio group — nothing to decide for a check that passed -->
              {#if risk.severity === "info"}
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
                      <label class="mb-1 block text-[11px] font-medium text-text">
                        {t("deployment.enterDefaultValue")}
                      </label>
                      <input
                        class={INPUT_CLASS}
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
