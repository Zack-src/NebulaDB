<script lang="ts" module>
  import type { SchemaRisk, SeedResult } from "@athanordb/shared";

  /** Where a risk's answer goes in the resolutions — the server files it under the same key. */
  function riskKey(risk: SchemaRisk): string {
    if (risk.resolutionKey) return risk.resolutionKey;
    return risk.columnName
      ? `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`
      : `table:${risk.tableName.toLowerCase()}`;
  }
</script>

<script lang="ts">
  import { ApiError } from "@/services/ApiError";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import type {
    ConflictResolutionStrategy,
    DatabaseConnectionSummary,
    MigrationResolutionMap,
  } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
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
  import { DATA_LOSS_STRATEGIES, generateMigrationSql, type MigrationDialect } from "@athanordb/dbml-engine";
  import DeploymentHistoryPanel from "./DeploymentHistoryPanel.svelte";

  type Step = "diff" | "risks" | "sql" | "done" | "history";

  let {
    projectId,
    onClose,
    initialConnectionId,
    readOnly = false,
    canSkipStage = false,
    onShowProblems,
  }: {
    projectId: string;
    onClose: () => void;
    initialConnectionId?: string | null;
    /**
     * "Check Differences" entry point: same diff/risks/SQL preview as a real
     * deployment plan, minus the ability to act on it — no Apply button. Reuses
     * `plan-deployment` as-is rather than a second, lighter-weight diff
     * endpoint/UI, since the two would otherwise show the exact same data.
     */
    readOnly?: boolean;
    /** Instance administrators may deploy to a stage before the one ahead of it is level — with a reason. */
    canSkipStage?: boolean;
    /** Leaves the dialog for the schema's Problèmes tab — offered when lint errors block the deployment. */
    onShowProblems?: () => void;
  } = $props();

  const { t } = useTranslation();
  const modalTitle = $derived(readOnly ? t("deployment.checkDifferencesTitle") : t("deployment.title"));
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
    seedReport: SeedResult[];
    backupId: string | null;
  } | null>(null);
  /** Leave the tables' initial data out of this deployment. */
  let skipSeeds = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);
  /** Why the risks are accepted — kept with the deployment in its history. */
  let riskNote = $state("");
  /** `null` until someone ticks or unticks the box: the default then follows the connection (on for production). */
  let backupChoice = $state<boolean | null>(null);

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
        error = describeApiError(err, t);
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
      error = describeApiError(err, t);
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

  /** Open while a production deployment waits for its connection's name. */
  let confirmingProduction = $state(false);
  /** Set when the server refused the deployment because an earlier stage does not have this schema yet. */
  let stageBlocked = $state(false);
  let skipStage = $state(false);
  let skipReason = $state("");

  async function handleApplyDeployment(confirmName?: string) {
    if (!selectedConnId) return;
    if (selectedConn?.production && confirmName === undefined) {
      confirmingProduction = true;
      return;
    }
    confirmingProduction = false;
    deploying = true;
    error = null;
    try {
      deployResult = await applyDeployment(projectId, selectedConnId, resolutions, {
        confirmName,
        riskNote: riskNote.trim() || undefined,
        skipSeeds,
        backupBefore,
        ...(skipStage ? { skipStageOrder: true, skipReason: skipReason.trim() } : {}),
      });
      stageBlocked = false;
      activeStep = "done";
    } catch (err) {
      // In the reader's language, like every other refusal of the server.
      error = describeApiError(err, t);
      stageBlocked = err instanceof ApiError && err.code === "PIPELINE_STAGE_SKIPPED";
    } finally {
      skipStage = false;
      deploying = false;
    }
  }

  const selectedConn = $derived(connections.find((c) => c.id === selectedConnId));
  const backupBefore = $derived(backupChoice ?? selectedConn?.production ?? false);
  const diff = $derived(plan?.diff);
  const risks = $derived(plan?.risks ?? []);
  const seedPlan = $derived(plan?.seeds ?? []);
  const seedsToInsert = $derived(!skipSeeds && seedPlan.some((entry) => entry.action === "insert"));
  const seedsBroken = $derived(
    !skipSeeds && (seedPlan.some((entry) => entry.errors > 0) || (plan?.seedCycles.length ?? 0) > 0),
  );
  /** Something to deploy: schema changes, or seeds to insert into an unchanged schema. */
  const hasWork = $derived(Boolean(diff?.hasChanges) || seedsToInsert);
  const strategyOf = (risk: SchemaRisk) => resolutions[riskKey(risk)]?.strategy ?? risk.defaultStrategy;
  /** Risks answered "cancel / handle manually": the server refuses the deployment while there is one. */
  const blockingRisks = $derived(risks.filter((risk) => risk.severity !== "info" && strategyOf(risk) === "CANCEL"));
  const losesData = $derived(risks.some((risk) => DATA_LOSS_STRATEGIES.has(strategyOf(risk))));
  // The SQL that will run, with the answers given so far — not the plan's first draft.
  const sqlPreview = $derived(
    plan ? generateMigrationSql(plan.diff, plan.engine as MigrationDialect, resolutions) : "-- No SQL generated",
  );

  const TAB = "border-b-2 px-3 py-2 font-medium transition-colors";
  const tabState = (step: Step) =>
    activeStep === step ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text";
</script>

{#if loading}
  <Modal title={modalTitle} {onClose}>
    <div class="flex h-48 items-center justify-center text-xs text-text-muted">{t("common.loading")}</div>
  </Modal>
{:else if connections.length === 0}
  <Modal title={modalTitle} {onClose}>
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
  <Modal title={modalTitle} {onClose} wide>
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
      {/if}

      <!-- The tables' initial data, inserted after the DDL -->
      {#if activeStep === "diff" && !analyzing && !readOnly && plan}
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
      {#if activeStep === "diff" && !analyzing && seedPlan.length > 0}
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
                      {/if}
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
            value={sqlPreview}
          ></textarea>
          {#if losesData && !readOnly}
            <label class="block pt-1 text-xs text-text">
              <span class="mb-1 block font-semibold">{t("deployment.riskNote")}</span>
              <textarea
                class={`${INPUT_CLASS} h-14 w-full`}
                bind:value={riskNote}
                maxlength={1000}
                placeholder={t("deployment.riskNotePlaceholder")}
              ></textarea>
            </label>
          {/if}
          {#if !readOnly}
            <Checkbox checked={backupBefore} onChange={(checked) => (backupChoice = checked)} hint={t("deployment.backupBeforeHint")}>
              <span class="text-xs">{t("deployment.backupBefore")}</span>
            </Checkbox>
          {/if}
          {#if blockingRisks.length > 0}
            <p class="text-xs text-danger" role="alert">{t("deployment.blockedByCancel", { count: blockingRisks.length })}</p>
          {/if}
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
          {#if deployResult.backupId}
            <p class="mt-1 text-text-muted" data-testid="deploy-backup">{t("deployment.backupTaken")}</p>
          {/if}
          {#if deployResult.seedReport.length > 0}
            <ul class="mt-3 space-y-0.5 text-left font-mono text-[11px]" data-testid="seed-report">
              {#each deployResult.seedReport as result (result.tableName)}
                <li class={result.error ? "text-danger" : "text-text"}>
                  {result.tableName} :
                  {result.error
                    ? t("seeds.reportFailed", { error: result.error })
                    : result.skipped
                      ? t("seeds.reportSkipped")
                      : t("seeds.reportInserted", { count: result.inserted })}
                </li>
              {/each}
            </ul>
          {/if}
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
          <DeploymentHistoryPanel
            {projectId}
            connId={selectedConnId}
            engine={selectedConn?.engine}
            production={selectedConn?.production}
            connectionName={selectedConn?.name}
          />
        {/key}
      {/if}

      {#if error}<ErrorText>{error}</ErrorText>{/if}
      {#if stageBlocked && canSkipStage}
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="stage-skip">
          <input
            class={`${INPUT_SM_CLASS} min-w-[220px] flex-1`}
            placeholder={t("pipeline.skipReasonPlaceholder")}
            aria-label={t("pipeline.skipReason")}
            maxlength={300}
            bind:value={skipReason}
          />
          <Button
            size="sm"
            variant="danger"
            disabled={deploying || !skipReason.trim()}
            onclick={() => {
              skipStage = true;
              void handleApplyDeployment();
            }}
          >
            {t("pipeline.skipAndDeploy")}
          </Button>
        </div>
      {/if}

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

          {#if activeStep === "diff" && hasWork}
            <Button size="sm" variant="primary" onclick={() => (activeStep = risks.length > 0 ? "risks" : "sql")}>
              {risks.length > 0 ? t("deployment.reviewRisks") : t("deployment.previewSql")}
            </Button>
          {/if}

          {#if activeStep === "risks"}
            <Button size="sm" variant="primary" onclick={() => (activeStep = "sql")}>{t("deployment.previewSql")}</Button>
          {/if}

          {#if activeStep === "sql" && !readOnly}
            <Button size="sm" variant="primary" onclick={() => void handleApplyDeployment()}
              disabled={deploying || !hasWork || blockingRisks.length > 0 || seedsBroken}
            >
              <Icon icon={CheckIcon} size={13} />
              {deploying ? t("deployment.deploying") : t("deployment.applyMigration")}
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </Modal>
{/if}

{#if confirmingProduction && selectedConn}
  <ConfirmDialog
    title={t("environments.deployTitle", { name: selectedConn.name })}
    message={t("environments.deployMessage", { environment: selectedConn.environment ?? "" })}
    danger="danger"
    requireText={selectedConn.name}
    confirmLabel={t("deployment.applyMigration")}
    onCancel={() => (confirmingProduction = false)}
    onConfirm={() => void handleApplyDeployment(selectedConn.name)}
  />
{/if}
