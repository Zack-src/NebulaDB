<script lang="ts">
  import type { DatabaseConnectionSummary } from "@nebuladb/shared";
  import { DatabaseIcon } from "@/components/icons/Icons";
  import NavLinkButton from "@/components/ui/NavLinkButton.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import DeploymentPanel from "@/features/connections/deployment/DeploymentPanel.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import CompareEnvironmentsCard from "./CompareEnvironmentsCard.svelte";
  import DeploymentReviewsCard from "./DeploymentReviewsCard.svelte";
  import MonitoringCard from "./MonitoringCard.svelte";
  import PipelineCard from "./PipelineCard.svelte";

  /** Deployment planning, application, pipeline and comparison of databases for the project. */
  let {
    projectId,
    connection,
    connections = [],
    refreshKey = 0,
    schemaHash,
    onDeployTo = () => {},
    canDeploy,
    canManage = false,
    tableNames = [],
    canSkipStage = false,
    onOpenConnectionsAdmin,
    onDeployed = () => {},
    onShowProblems,
    reviewsKey = 0,
    onShowInGraph,
    onShowInCode,
    tableExists,
    canClean = false,
  }: {
    projectId: string;
    /** The workspace's current connection; `null` when the project has none. */
    connection: DatabaseConnectionSummary | null;
    /** Every database of the project — two or more can be compared with each other. */
    connections?: DatabaseConnectionSummary[];
    /** Changes when a deployment completes: what the pipeline shows may be stale. */
    refreshKey?: number;
    /** The fingerprint of the schema as it is now: the pipeline follows it. */
    schemaHash?: string;
    /** Selects one of the project's databases for deployment. */
    onDeployTo?: (connectionId: string) => void;
    /** The project's `deploy` level or above: without it the plan can be read, not applied. */
    canDeploy: boolean;
    /** The project's administrators: the watch's settings are theirs, so the card is shown to them only. */
    canManage?: boolean;
    /** The tables of the schema as it is now: offered when choosing which to ignore in the watch. */
    tableNames?: string[];
    canSkipStage?: boolean;
    /** Takes an instance administrator to Admin → Connections to attach a database. */
    onOpenConnectionsAdmin?: () => void;
    onDeployed?: () => void;
    onShowProblems?: () => void;
    /** Changes when the server says a review request was made, decided or closed. */
    reviewsKey?: number;
    /** Centres the diagram on a table (and a column): offered on every conflict that names one. */
    onShowInGraph?: (tableName: string, fieldName?: string) => void;
    /** Scrolls the DBML code to a table. */
    onShowInCode?: (tableName: string) => void;
    /** Whether the diagram has this table. */
    tableExists?: (tableName: string) => boolean;
    /** The person may start over: see `DeploymentPanel`. */
    canClean?: boolean;
  } = $props();

  const { t } = useTranslation();
  /** Counts the requests made from the dialog below: the card lists one more. */
  let requested = $state(0);
</script>

<div class="flex min-h-full flex-col bg-surface">
  {#if !connection}
    <div class="px-3 py-4">
      <EmptyState>
        <p class="m-0 mb-3">{t("workspace.deployments.noConnection")}</p>
        {#if onOpenConnectionsAdmin}
          <NavLinkButton
            label={t("workspace.deployments.openConnections")}
            icon={DatabaseIcon}
            onNavigate={onOpenConnectionsAdmin}
          />
        {:else}
          <p class="m-0">{t("workspace.deployments.noConnectionMember")}</p>
        {/if}
      </EmptyState>
    </div>
  {:else}
    <DeploymentPanel
      {projectId}
      {schemaHash}
      initialConnectionId={connection.id}
      readOnly={!canDeploy}
      {canSkipStage}
      {onDeployed}
      {onShowProblems}
      {onShowInGraph}
      {onShowInCode}
      {tableExists}
      {canClean}
      onReviewRequested={() => (requested += 1)}
    />
    <!-- Follow-up under the panel: requests waiting for a colleague, and where each database stands. -->
    <div class="flex flex-col gap-3 border-t border-border px-3 py-3">
      <DeploymentReviewsCard
        {projectId}
        {connections}
        currentId={connection.id}
        refreshKey={reviewsKey + requested + refreshKey}
        {canSkipStage}
        {onDeployed}
      />
      <PipelineCard {projectId} {refreshKey} {schemaHash} {canDeploy} {onDeployTo} />
      <!-- The watch covers all the project's databases, not only the current one. -->
      {#if canManage}
        <MonitoringCard {projectId} canCheck={canDeploy} instanceAdmin={canSkipStage} {tableNames} />
      {/if}
      <!-- The server opens both databases only for those who may deploy. -->
      {#if canDeploy && connections.length > 1}
        <CompareEnvironmentsCard {projectId} {connections} currentId={connection.id} {onShowInGraph} />
      {/if}
    </div>
  {/if}
</div>
