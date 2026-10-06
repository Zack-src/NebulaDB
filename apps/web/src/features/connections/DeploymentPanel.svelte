<script lang="ts">
  import { ApiError } from "@/services/ApiError";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import type {
    ConflictResolutionStrategy,
    DatabaseConnectionSummary,
    MigrationResolutionMap,
    SchemaRisk,
  } from "@athanordb/shared";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon, DatabaseIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    applyDeployment,
    listProjectConnections,
    planDeployment,
    type ApplyDeploymentResponse,
    type PlanDeploymentResponse,
  } from "@/services/connectionsApi";
  import { copyText } from "@/utils/clipboard";
  import { DATA_LOSS_STRATEGIES, generateMigrationSql, type MigrationDialect } from "@athanordb/dbml-engine";
  import DeploymentHistoryPanel from "./DeploymentHistoryPanel.svelte";
  import DeploymentDiffStep from "./deployment/DeploymentDiffStep.svelte";
  import DeploymentResultStep from "./deployment/DeploymentResultStep.svelte";
  import DeploymentRisksStep from "./deployment/DeploymentRisksStep.svelte";
  import DeploymentSqlStep from "./deployment/DeploymentSqlStep.svelte";
  import DeploymentStageSkip from "./deployment/DeploymentStageSkip.svelte";
  import DeploymentStepTabs from "./deployment/DeploymentStepTabs.svelte";
  import { riskKey, type DeploymentStep } from "./deployment/deploymentModel";

  /**
   * The deployment panel: picks a connection, plans the deployment against
   * it, and walks through the steps — diff, risks, SQL, result, history. It
   * keeps the state, the loading and the navigation; each step's display
   * lives in `./deployment/`.
   */
  let {
    projectId,
    schemaHash,
    onDeployed = () => {},
    initialConnectionId,
    readOnly = false,
    canSkipStage = false,
    onShowProblems,
  }: {
    projectId: string;
    schemaHash?: string;
    onDeployed?: () => void;
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
  let connections = $state.raw<DatabaseConnectionSummary[]>([]);
  let selectedConnId = $state<string>("");
  let loading = $state(true);
  let analyzing = $state(false);
  let plan = $state.raw<PlanDeploymentResponse | null>(null);
  let resolutions = $state.raw<MigrationResolutionMap>({});
  let activeStep = $state<DeploymentStep>("diff");
  let deploying = $state(false);
  let deployResult = $state.raw<ApplyDeploymentResponse | null>(null);
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
  let analysisVersion = 0;
  async function runAnalysis(connId: string) {
    const version = ++analysisVersion;
    if (!connId) return;
    analyzing = true;
    error = null;
    plan = null;
    deployResult = null;
    try {
      const res = await planDeployment(projectId, connId);
      if (version !== analysisVersion) return;
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
      if (version === analysisVersion) error = describeApiError(err, t);
    } finally {
      if (version === analysisVersion) analyzing = false;
    }
  }

  $effect(() => {
    const connId = selectedConnId;
    if (!connId) return;
    if (schemaHash || connId) void runAnalysis(connId);
  });

  function handleStrategyChange(risk: SchemaRisk, strategy: ConflictResolutionStrategy, value?: string) {
    const key = riskKey(risk);
    resolutions = {
      ...resolutions,
      [key]: { strategy, value: value !== undefined ? value : resolutions[key]?.value },
    };
  }

  function handleCopySql() {
    // What the textarea shows: the SQL as the answers given to the risks shape it, not the plan's first draft.
    const sql = sqlPreview;
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
      onDeployed();
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
</script>

{#if loading}
  <section data-testid="deployment-panel" class="rounded-md border border-border bg-surface p-4">
    <div class="flex h-48 items-center justify-center text-xs text-text-muted">{t("common.loading")}</div>
  </section>
{:else if connections.length === 0}
  <section data-testid="deployment-panel" class="rounded-md border border-border bg-surface p-4">
    <div class="space-y-4 py-4 text-center">
      <Icon icon={DatabaseIcon} size={32} class="mx-auto text-text-muted" />
      <div>
        <h3 class="text-sm font-bold text-text">{t("deployment.noConnectionTitle")}</h3>
        <p class="mt-1 text-xs text-text-muted">{t("deployment.noConnectionDesc")}</p>
      </div>
      <div class="flex justify-center gap-2 pt-2"></div>
    </div>
  </section>
{:else}
  <section data-testid="deployment-panel" class="rounded-md border border-border bg-surface p-4">
    <div class="space-y-4">
      <!-- Header toolbar: connection selection -->
      <div
        class="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-raised p-2.5"
      >
        <div class="flex items-center gap-2">
          <Icon icon={DatabaseIcon} size={16} class="text-accent" />
          <span class="text-xs font-semibold text-text">{t("deployment.targetDatabase")}:</span>
          <strong class="text-xs">{selectedConn?.name}</strong>
        </div>

        <div class="flex items-center gap-2">
          <Button size="xs" variant="ghost" onclick={() => void runAnalysis(selectedConnId)} disabled={analyzing}>
            {analyzing ? t("deployment.analyzing") : t("deployment.refreshDiff")}
          </Button>
        </div>
      </div>

      <DeploymentStepTabs
        bind:activeStep
        tableCount={diff?.tables.length}
        riskCount={risks.length}
        hasResult={deployResult !== null}
      />

      {#if activeStep === "diff"}
        <DeploymentDiffStep
          {plan}
          {analyzing}
          {readOnly}
          {canSkipStage}
          {seedsToInsert}
          bind:skipSeeds
          {onShowProblems}
        />
      {/if}

      {#if activeStep === "risks"}
        <DeploymentRisksStep {risks} {resolutions} onStrategyChange={handleStrategyChange} />
      {/if}

      {#if activeStep === "sql"}
        <DeploymentSqlStep
          sql={sqlPreview}
          {readOnly}
          {losesData}
          bind:riskNote
          {backupBefore}
          onBackupChange={(checked) => (backupChoice = checked)}
          blockingRiskCount={blockingRisks.length}
          {copied}
          onCopy={handleCopySql}
        />
      {/if}

      {#if activeStep === "done" && deployResult}
        <DeploymentResultStep result={deployResult} connectionName={selectedConn?.name || ""} />
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
        <DeploymentStageSkip
          bind:skipReason
          {deploying}
          onSkip={() => {
            skipStage = true;
            void handleApplyDeployment();
          }}
        />
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
          {#if activeStep === "diff" && hasWork}
            <Button size="sm" variant="primary" onclick={() => (activeStep = risks.length > 0 ? "risks" : "sql")}>
              {risks.length > 0 ? t("deployment.reviewRisks") : t("deployment.previewSql")}
            </Button>
          {/if}

          {#if activeStep === "risks"}
            <Button size="sm" variant="primary" onclick={() => (activeStep = "sql")}
              >{t("deployment.previewSql")}</Button
            >
          {/if}

          {#if activeStep === "sql" && !readOnly}
            <Button
              size="sm"
              variant="primary"
              onclick={() => void handleApplyDeployment()}
              disabled={deploying || !hasWork || blockingRisks.length > 0 || seedsBroken}
            >
              <Icon icon={CheckIcon} size={13} />
              {deploying ? t("deployment.deploying") : t("deployment.applyMigration")}
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </section>
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
