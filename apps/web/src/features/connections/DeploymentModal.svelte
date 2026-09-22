<script lang="ts" module>
  import type { SchemaRisk } from "@athanordb/shared";

  function riskKey(risk: SchemaRisk): string {
    return risk.columnName
      ? `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`
      : `table:${risk.tableName.toLowerCase()}`;
  }
</script>

<script lang="ts">
  import type {
    ConflictResolutionStrategy,
    DatabaseConnectionSummary,
    MigrationResolutionMap,
  } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, DatabaseIcon } from "@/components/icons/Icons";
  import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import {
    applyDeployment,
    listProjectConnections,
    planDeployment,
    type PlanDeploymentResponse,
  } from "@/services/connectionsApi";
  import { copyText } from "@/utils/clipboard";
  import DeploymentHistoryPanel from "./DeploymentHistoryPanel.svelte";

  type Step = "diff" | "risks" | "sql" | "done" | "history";

  let {
    projectId,
    onClose,
    initialConnectionId,
  }: { projectId: string; onClose: () => void; initialConnectionId?: string | null } = $props();

  const { t } = useTranslation();
  let connections = $state.raw<DatabaseConnectionSummary[]>([]);
  let selectedConnId = $state<string>("");
  let loading = $state(true);
  let analyzing = $state(false);
  let plan = $state.raw<PlanDeploymentResponse | null>(null);
  let resolutions = $state.raw<MigrationResolutionMap>({});
  let activeStep = $state<Step>("diff");
  let deploying = $state(false);
  let deployResult = $state.raw<{
    success: boolean;
    executedStatements: number;
    sql: string;
    rollbackAvailable: boolean;
    irreversibleWarnings: string[];
  } | null>(null);
  let error = $state<string | null>(null);
  let copied = $state(false);

  // Load connections for this project
  $effect(() => {
    const id = projectId;
    const initial = initialConnectionId;
    void (async () => {
      try {
        loading = true;
        const list = await listProjectConnections(id);
        connections = list;
        if (list.length > 0) {
          const match = initial && list.some((c) => c.id === initial);
          selectedConnId = match ? initial! : list[0].id;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        loading = false;
      }
    })();
  });

  // Run analysis whenever the selected connection changes
  async function runAnalysis(connId: string) {
    if (!connId) return;
    analyzing = true;
    error = null;
    plan = null;
    deployResult = null;
    try {
      const res = await planDeployment(projectId, connId);
      plan = res;

      // Initialize resolutions from risks
      const initialRes: MigrationResolutionMap = {};
      for (const risk of res.risks) {
        initialRes[riskKey(risk)] = {
          strategy: risk.defaultStrategy,
          value: risk.userProvidedValue,
        };
      }
      resolutions = initialRes;
      activeStep = res.risks.length > 0 ? "risks" : "diff";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      analyzing = false;
    }
  }

  $effect(() => {
    const connId = selectedConnId;
    if (!connId) return;
    void runAnalysis(connId);
  });

  function handleStrategyChange(risk: SchemaRisk, strategy: ConflictResolutionStrategy, value?: string) {
    const key = riskKey(risk);
    resolutions = {
      ...resolutions,
      [key]: { strategy, value: value !== undefined ? value : resolutions[key]?.value },
    };
  }

  function handleCopySql() {
    const sql = plan?.sqlPreview ?? "";
    void copyText(sql).then((ok) => {
      if (ok) {
        copied = true;
        setTimeout(() => (copied = false), 1500);
      }
    });
  }

  async function handleApplyDeployment() {
    if (!selectedConnId) return;
    deploying = true;
    error = null;
    try {
      deployResult = await applyDeployment(projectId, selectedConnId, resolutions);
      activeStep = "done";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      deploying = false;
    }
  }

  const selectedConn = $derived(connections.find((c) => c.id === selectedConnId));
  const diff = $derived(plan?.diff);
  const risks = $derived(plan?.risks ?? []);

  const TAB = "border-b-2 px-3 py-2 font-medium transition-colors";
  const tabState = (step: Step) =>
    activeStep === step ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text";
</script>

{#if loading}
  <Modal title={t("deployment.title")} {onClose}>
    <div class="flex h-48 items-center justify-center text-xs text-text-muted">{t("common.loading")}</div>
  </Modal>
{:else if connections.length === 0}
  <Modal title={t("deployment.title")} {onClose}>
    <div class="space-y-4 py-4 text-center">
      <Icon icon={DatabaseIcon} size={32} class="mx-auto text-text-muted" />
      <div>
        <h3 class="text-sm font-bold text-text">{t("deployment.noConnectionTitle")}</h3>
        <p class="mt-1 text-xs text-text-muted">{t("deployment.noConnectionDesc")}</p>
      </div>
      <div class="flex justify-center gap-2 pt-2">
        <Button size="sm" variant="ghost" onclick={onClose}>{t("common.cancel")}</Button>
      </div>
    </div>
  </Modal>
{:else}
  <Modal title={t("deployment.title")} {onClose} wide>
    <div class="space-y-4">
      <!-- Header toolbar: connection selection -->
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-raised p-2.5">
        <div class="flex items-center gap-2">
          <Icon icon={DatabaseIcon} size={16} class="text-accent" />
          <span class="text-xs font-semibold text-text">{t("deployment.targetDatabase")}:</span>
          <select class={`${SELECT_CLASS} !py-1 text-xs font-medium`} bind:value={selectedConnId}>
            {#each connections as c (c.id)}
              <option value={c.id}>{c.name} ({c.engine})</option>
            {/each}
          </select>
        </div>

        <div class="flex items-center gap-2">
          <Button size="xs" variant="ghost" onclick={() => void runAnalysis(selectedConnId)} disabled={analyzing}>
            {analyzing ? t("deployment.analyzing") : t("deployment.refreshDiff")}
          </Button>
        </div>
      </div>

      <!-- Step navigation tabs -->
      <div class="flex border-b border-border text-xs">
        <button type="button" class={`${TAB} ${tabState("diff")}`} onclick={() => (activeStep = "diff")}>
          {t("deployment.stepDiff")}
          {diff ? `(${diff.tables.length})` : ""}
        </button>
        <button
          type="button"
          class={`flex items-center gap-1.5 ${TAB} ${tabState("risks")}`}
          onclick={() => (activeStep = "risks")}
        >
          <span>{t("deployment.stepRisks")}</span>
          {#if risks.length > 0}<Badge tone="warning">{risks.length}</Badge>{/if}
        </button>
        <button type="button" class={`${TAB} ${tabState("sql")}`} onclick={() => (activeStep = "sql")}>
          {t("deployment.stepSql")}
        </button>
        <button type="button" class={`${TAB} ${tabState("history")}`} onclick={() => (activeStep = "history")}>
          {t("deployment.stepHistory")}
        </button>
        {#if deployResult}
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

      <!-- Step 1: Schema Diff View -->
      {#if activeStep === "diff"}
        <div class="space-y-3">
          {#if analyzing}
            <div class="flex h-48 items-center justify-center text-xs text-text-muted">
              {t("deployment.analyzingDiff")}
            </div>
          {:else if !diff?.hasChanges}
            <div class="rounded-sm border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
              <Icon icon={CheckCircleIcon} size={24} class="mx-auto mb-2 text-emerald-400" />
              <p class="font-semibold text-text">{t("deployment.inSync")}</p>
              <p class="mt-1">{t("deployment.inSyncDesc")}</p>
            </div>
          {:else}
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
      {/if}

      <!-- Step 2: Risk and Conflict Resolution -->
      {#if activeStep === "risks"}
        <div class="space-y-4">
          {#if risks.length === 0}
            <div class="rounded-sm border border-emerald-500/20 bg-emerald-500/10 p-4 text-center text-xs text-emerald-400">
              <Icon icon={CheckCircleIcon} size={20} class="mx-auto mb-1.5" />
              <p class="font-semibold">{t("deployment.noRisksDetected")}</p>
              <p class="mt-0.5 text-text-muted">{t("deployment.noRisksDesc")}</p>
            </div>
          {:else}
            <div class="max-h-84 space-y-3 overflow-y-auto pr-1">
              {#each risks as risk (risk.id)}
                {@const currentRes = resolutions[riskKey(risk)]}
                <div
                  class={`rounded-sm border p-3.5 text-xs ${
                    risk.severity === "critical" ? "border-rose-500/40 bg-rose-500/5" : "border-amber-500/40 bg-amber-500/5"
                  }`}
                >
                  <div class="flex items-start gap-2.5">
                    <Icon
                      icon={AlertTriangleIcon}
                      size={16}
                      class={risk.severity === "critical" ? "text-rose-400" : "text-amber-400"}
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
                          {#if risk.type === "TYPE_TRANSLATION_SUGGESTED"}
                            <span>
                              {t("deployment.riskTypeTranslation", { col: risk.columnName || "", table: risk.tableName })}
                              {#if risk.suggestedValue}
                                <span class="ml-1 font-mono font-normal text-text-muted">({risk.suggestedValue})</span>
                              {/if}
                            </span>
                          {/if}
                        </h4>
                        <Badge tone={risk.severity === "critical" ? "danger" : "warning"}>
                          {risk.affectedRowCount}
                          {t("deployment.rowsAffected")}
                        </Badge>
                      </div>

                      <!-- Data Sample Preview -->
                      {#if risk.sampleData && risk.sampleData.length > 0}
                        <div class="rounded-sm border border-border bg-surface-raised p-2 text-[11px]">
                          <span class="mb-1 block font-semibold text-text-muted">
                            {t("deployment.dataSamplePreview")} ({risk.sampleData.length}
                            {t("deployment.items")}):
                          </span>
                          <div class="flex flex-wrap gap-1.5">
                            {#each risk.sampleData as item, i (i)}
                              <span
                                class="inline-block max-w-[200px] truncate rounded bg-surface px-1.5 py-0.5 font-mono text-text shadow-xs"
                              >
                                {typeof item === "object" ? JSON.stringify(item) : String(item)}
                              </span>
                            {/each}
                          </div>
                        </div>
                      {/if}

                      <!-- Strategy selector radio group -->
                      <div class="space-y-1.5 pt-1">
                        <span class="block font-semibold text-text">{t("deployment.selectStrategy")}:</span>
                        <div class="space-y-1">
                          {#each risk.availableStrategies as opt (opt.key)}
                            {@const selected = currentRes?.strategy === opt.key}
                            <label
                              class={`flex cursor-pointer items-center justify-between rounded-sm border p-2 text-xs transition-colors ${
                                selected
                                  ? "border-accent bg-accent/10 font-medium text-accent"
                                  : "border-border bg-surface text-text hover:bg-surface-hover"
                              }`}
                            >
                              <div class="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={risk.id}
                                  checked={selected}
                                  onchange={() => handleStrategyChange(risk, opt.key)}
                                  class="text-accent"
                                />
                                <span>{t(opt.labelKey as TranslationKeyOf)}</span>
                              </div>
                              <span class="text-[10px] text-text-muted">{t(opt.descriptionKey as TranslationKeyOf)}</span>
                            </label>
                          {/each}
                        </div>

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
                              oninput={(e) => handleStrategyChange(risk, "BACKFILL_DEFAULT", e.currentTarget.value)}
                              placeholder="ex: 'default_value' or 0"
                            />
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Step 3: SQL Preview -->
      {#if activeStep === "sql"}
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-text-muted">{t("deployment.generatedSqlScript")}</span>
            <Button size="xs" variant="ghost" onclick={handleCopySql}>
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
          </div>
          <textarea
            readonly
            class={`${TEXTAREA_CODE_CLASS} h-72 w-full`}
            value={plan?.sqlPreview ?? "-- No SQL generated"}
          ></textarea>
        </div>
      {/if}

      <!-- Step 4: Done result -->
      {#if activeStep === "done" && deployResult}
        <div class="rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-6 text-center text-xs">
          <Icon icon={CheckCircleIcon} size={32} class="mx-auto mb-2 text-emerald-400" />
          <h3 class="text-base font-bold text-text">{t("deployment.deploySuccessTitle")}</h3>
          <p class="mt-1 text-text-muted">
            {t("deployment.deploySuccessDesc", {
              count: deployResult.executedStatements,
              name: selectedConn?.name || "",
            })}
          </p>
          {#if deployResult.irreversibleWarnings.length > 0}
            <div class="mt-3 space-y-1 rounded-sm border border-amber-500/40 bg-amber-500/5 p-2.5 text-left text-[11px] text-amber-300">
              <p class="font-semibold">{t("deployment.rollbackIrreversibleTitle")}</p>
              <ul class="list-disc space-y-0.5 pl-4">
                {#each deployResult.irreversibleWarnings as warning (warning)}
                  <li>{warning}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Step 5: Deployment history for this connection, with rollback -->
      {#if activeStep === "history" && selectedConnId}
        {#key selectedConnId}
          <DeploymentHistoryPanel {projectId} connId={selectedConnId} engine={selectedConn?.engine} />
        {/key}
      {/if}

      {#if error}<ErrorText>{error}</ErrorText>{/if}

      <!-- Modal footer actions -->
      <div class="flex items-center justify-between border-t border-border pt-4">
        <div class="flex items-center gap-2">
          {#if activeStep === "risks"}
            <Button size="sm" variant="ghost" onclick={() => (activeStep = "diff")}>{t("common.back")}</Button>
          {/if}
          {#if activeStep === "sql"}
            <Button size="sm" variant="ghost" onclick={() => (activeStep = risks.length > 0 ? "risks" : "diff")}>
              {t("common.back")}
            </Button>
          {/if}
        </div>

        <div class="flex items-center gap-2">
          <Button size="sm" variant="ghost" onclick={onClose}>{t("common.close")}</Button>

          {#if activeStep === "diff" && diff?.hasChanges}
            <Button size="sm" variant="primary" onclick={() => (activeStep = risks.length > 0 ? "risks" : "sql")}>
              {risks.length > 0 ? t("deployment.reviewRisks") : t("deployment.previewSql")}
            </Button>
          {/if}

          {#if activeStep === "risks"}
            <Button size="sm" variant="primary" onclick={() => (activeStep = "sql")}>{t("deployment.previewSql")}</Button>
          {/if}

          {#if activeStep === "sql"}
            <Button size="sm" variant="primary" onclick={handleApplyDeployment} disabled={deploying || !diff?.hasChanges}>
              <Icon icon={CheckIcon} size={13} />
              {deploying ? t("deployment.deploying") : t("deployment.applyMigration")}
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </Modal>
{/if}
