<script lang="ts">
  import { untrack } from "svelte";
  import { ApiError } from "@/services/ApiError";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import type {
    ConflictResolutionStrategy,
    DatabaseConnectionSummary,
    MigrationResolutionMap,
    SchemaRisk,
  } from "@nebuladb/shared";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon, DatabaseIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Tabs, { type TabItem } from "@/components/ui/Tabs.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    applyDeployment,
    listProjectConnections,
    planDeployment,
    requestDeploymentReview,
    type ApplyDeploymentResponse,
    type PlanDeploymentResponse,
  } from "@/services/connectionsApi";
  import { copyText } from "@/utils/clipboard";
  import { DATA_LOSS_STRATEGIES, generateMigrationSql, type MigrationDialect } from "@nebuladb/dbml-engine";
  import DeploymentFailureBlock from "./DeploymentFailureBlock.svelte";
  import { parseDeploymentFailure, type DeploymentFailure } from "./deploymentFailure";
  import DeploymentHistoryPanel from "./DeploymentHistoryPanel.svelte";
  import DeploymentDiffStep from "./DeploymentDiffStep.svelte";
  import DeploymentResultStep from "./DeploymentResultStep.svelte";
  import DeploymentRisksStep from "./DeploymentRisksStep.svelte";
  import DeploymentSqlStep from "./DeploymentSqlStep.svelte";
  import DeploymentStageSkip from "./DeploymentStageSkip.svelte";
  import { riskKey, type DeploymentStep } from "./deploymentModel";

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
    onReviewRequested = () => {},
    onShowInGraph,
    onShowInCode,
    tableExists,
  }: {
    projectId: string;
    schemaHash?: string;
    onDeployed?: () => void;
    /** A review was asked for instead of deploying: whoever lists the requests has one more. */
    onReviewRequested?: () => void;
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
    /** Centres the diagram on the table (and column) a conflict names: offered when the panel sits beside it. */
    onShowInGraph?: (tableName: string, fieldName?: string) => void;
    /** Scrolls the DBML code to the table a conflict names. */
    onShowInCode?: (tableName: string) => void;
    /** Whether the diagram has this table: see `DeploymentRisksStep`. */
    tableExists?: (tableName: string) => boolean;
  } = $props();

  const { t } = useTranslation();
  let connections = $state.raw<DatabaseConnectionSummary[]>([]);
  let selectedConnId = $state<string>("");
  let loading = $state(true);
  let analyzing = $state(false);
  let plan = $state.raw<PlanDeploymentResponse | null>(null);
  /** The schema fingerprint and connection the plan above was made for: what tells that it has gone stale. */
  let analyzedHash = $state<string | undefined>(undefined);
  let analyzedConnId = "";
  /** The schema was edited after the analysis: the plan is kept (it can take long to redo) and flagged, not redone. */
  const stale = $derived(
    plan !== null && !analyzing && schemaHash !== undefined && analyzedHash !== undefined && schemaHash !== analyzedHash,
  );
  let resolutions = $state.raw<MigrationResolutionMap>({});
  let activeStep = $state<DeploymentStep>("diff");
  let deploying = $state(false);
  let deployResult = $state.raw<ApplyDeploymentResponse | null>(null);
  /** Leave the tables' initial data out of this deployment. */
  let skipSeeds = $state(false);
  let error = $state<string | null>(null);
  /** Which statement the database refused, when the answer says: shown with the statement instead of a bare message. */
  let failure = $state.raw<DeploymentFailure | null>(null);
  let copied = $state(false);
  /** Why the risks are accepted — kept with the deployment in its history. */
  let riskNote = $state("");
  /** What the requester writes for the reviewer, on a stage that asks for a review. */
  let reviewMessage = $state("");
  /** Set once the review was asked for: the step then says so instead of offering the button again. */
  let reviewRequested = $state(false);
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
    // A refresh of the same database keeps the answers already given to the conflicts, and the step on screen.
    const sameConnection = analyzedConnId === connId;
    const previousResolutions = sameConnection ? resolutions : {};
    const previousStep = activeStep;
    analyzedConnId = connId;
    analyzedHash = schemaHash;
    analyzing = true;
    error = null;
    plan = null;
    deployResult = null;
    reviewRequested = false;
    try {
      const res = await planDeployment(projectId, connId);
      if (version !== analysisVersion) return;
      plan = res;

      // Initialize resolutions from risks
      const initialRes: MigrationResolutionMap = {};
      for (const risk of res.risks) {
        const earlier = previousResolutions[riskKey(risk)];
        const stillOffered = earlier && risk.availableStrategies.some((option) => option.key === earlier.strategy);
        initialRes[riskKey(risk)] = stillOffered
          ? earlier
          : {
              strategy: risk.defaultStrategy,
              value: risk.userProvidedValue,
            };
      }
      resolutions = initialRes;
      activeStep =
        sameConnection && previousStep !== "done" ? previousStep : res.risks.length > 0 ? "risks" : "diff";
    } catch (err) {
      if (version === analysisVersion) error = describeApiError(err, t);
    } finally {
      if (version === analysisVersion) analyzing = false;
    }
  }

  $effect(() => {
    const connId = selectedConnId;
    if (!connId) return;
    // Not tracked: an edit of the schema flags the plan as stale (`stale`), it does not start the analysis again.
    void untrack(() => runAnalysis(connId));
  });

  // A finished deployment has nothing left to protect: when the schema moves on after it, the analysis starts again by itself.
  $effect(() => {
    if (stale && deployResult !== null) untrack(() => void runAnalysis(selectedConnId));
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
    failure = null;
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
      failure = err instanceof ApiError && err.code === "MIGRATION_FAILED" ? parseDeploymentFailure(err.details) : null;
      stageBlocked = err instanceof ApiError && err.code === "PIPELINE_STAGE_SKIPPED";
    } finally {
      skipStage = false;
      deploying = false;
    }
  }

  /** On a stage whose protection is "Revue", the last step asks for a review; the deployment is the approved request's. */
  async function handleRequestReview() {
    if (!selectedConnId) return;
    deploying = true;
    error = null;
    try {
      await requestDeploymentReview(projectId, selectedConnId, resolutions, {
        riskNote: riskNote.trim() || undefined,
        skipSeeds,
        message: reviewMessage.trim() || undefined,
      });
      reviewRequested = true;
      reviewMessage = "";
      onReviewRequested();
    } catch (err) {
      error = describeApiError(err, t);
    } finally {
      deploying = false;
    }
  }

  const selectedConn = $derived(connections.find((c) => c.id === selectedConnId));
  const needsReview = $derived(selectedConn?.protection === "review");
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
  const stepTabs = $derived.by(() => {
    const items: TabItem<DeploymentStep>[] = [
      { id: "diff", label: t("deployment.stepDiffShort"), badge: diff ? diff.tables.length : undefined },
      { id: "risks", label: t("deployment.stepRisksShort"), badge: risks.length > 0 ? risks.length : undefined },
      { id: "sql", label: t("deployment.stepSqlShort") },
      { id: "history", label: t("deployment.stepHistoryShort") },
    ];
    if (deployResult) items.push({ id: "done", label: t("deployment.stepDoneShort") });
    return items;
  });
  /** The bar of actions under the steps: only there when the step on screen has something to do. */
  const hasFooter = $derived(
    (activeStep === "diff" && hasWork) || activeStep === "risks" || (activeStep === "sql" && !readOnly),
  );
</script>

{#if loading}
  <section data-testid="deployment-panel" class="px-3 py-4">
    <div class="flex h-32 items-center justify-center text-xs text-text-muted">{t("common.loading")}</div>
  </section>
{:else if connections.length === 0}
  <section data-testid="deployment-panel" class="px-3 py-4">
    <div class="space-y-4 py-4 text-center">
      <Icon icon={DatabaseIcon} size={32} class="mx-auto text-text-muted" />
      <div>
        <h3 class="text-sm font-bold text-text">{t("deployment.noConnectionTitle")}</h3>
        <p class="mt-1 text-xs text-text-muted">{t("deployment.noConnectionDesc")}</p>
      </div>
    </div>
  </section>
{:else}
  <section data-testid="deployment-panel" class="flex min-h-full flex-col">
    <!-- One line says which database this is about and offers the analysis again. -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <Icon icon={DatabaseIcon} size={14} class="shrink-0 text-text-muted" />
      <strong class="min-w-0 truncate text-body-sm text-text" title={selectedConn?.name}>{selectedConn?.name}</strong>
      {#if selectedConn}
        <Badge tone="admin">{t(`connections.engine.${selectedConn.engine}`)}</Badge>
        {#if selectedConn.environment}
          <EnvironmentBadge
            name={selectedConn.environment}
            color={selectedConn.environmentColor}
            production={selectedConn.production}
          />
        {/if}
      {/if}
      <span class="flex-1"></span>
      <Button
        size="xs"
        variant="ghost"
        onclick={() => void runAnalysis(selectedConnId)}
        disabled={analyzing}
        data-tooltip={t("deployment.refreshDiff")}
        data-tooltip-pos="bottom"
      >
        {analyzing ? t("deployment.analyzing") : t("deployment.refreshDiff")}
      </Button>
    </div>

    <Tabs
      variant="line"
      tabs={stepTabs}
      activeTab={activeStep}
      onChange={(id) => (activeStep = id)}
      aria-label={t("workspace.deployments.title")}
      class="px-3 pt-1"
    />

    <div class="min-h-0 flex-1 space-y-3 px-3 py-3">
      {#if stale}
        <div
          role="status"
          class="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-text"
        >
          <span class="min-w-0 flex-1 basis-48">{t("deployment.stale")}</span>
          <Button size="xs" variant="outline" onclick={() => void runAnalysis(selectedConnId)}>
            {t("deployment.staleAction")}
          </Button>
        </div>
      {/if}

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
        <DeploymentRisksStep
          {risks}
          {resolutions}
          {analyzing}
          onStrategyChange={handleStrategyChange}
          {onShowInGraph}
          {onShowInCode}
          {tableExists}
        />
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
          {needsReview}
          bind:reviewMessage
        />
        {#if reviewRequested}
          <p class="m-0 text-xs text-success" role="status" data-testid="review-requested">{t("review.requested")}</p>
        {/if}
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

      {#if failure}
        <DeploymentFailureBlock {failure} {onShowInGraph} {onShowInCode} {tableExists} />
      {:else if error}<ErrorText>{error}</ErrorText>{/if}
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
    </div>

    {#if hasFooter}
      <!-- Stays at the foot of the panel while a long list of conflicts or a long script scrolls. -->
      <div class="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2">
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

          {#if activeStep === "sql" && !readOnly && needsReview}
            <Button
              size="sm"
              variant="primary"
              onclick={() => void handleRequestReview()}
              disabled={deploying || reviewRequested || !hasWork || blockingRisks.length > 0 || seedsBroken}
            >
              <Icon icon={CheckIcon} size={13} />
              {deploying ? t("review.requesting") : t("review.request")}
            </Button>
          {:else if activeStep === "sql" && !readOnly}
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
    {/if}
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
