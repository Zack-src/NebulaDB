<script lang="ts">
  import type { DatabaseConnectionSummary } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { DatabaseIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import DeploymentPanel from "@/features/connections/deployment/DeploymentPanel.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import CompareEnvironmentsCard from "./CompareEnvironmentsCard.svelte";
  import DeploymentReviewsCard from "./DeploymentReviewsCard.svelte";
  import PipelineCard from "./PipelineCard.svelte";
  import MonitoringCard from "./MonitoringCard.svelte";

  /** Deployment planning, application, pipeline and monitoring for the project. */
  let {
    projectId,
    connection,
    connections = [],
    onOpenTable = () => {},
    refreshKey = 0,
    schemaHash,
    tableNames = [],
    onDeployTo = () => {},
    canDeploy,
    canManage,
    canSkipStage = false,
    onDeployed = () => {},
    onShowProblems,
    reviewsKey = 0,
  }: {
    projectId: string;
    /** The workspace's current connection; `null` when the project has none. */
    connection: DatabaseConnectionSummary | null;
    /** Every database of the project — two or more can be compared with each other. */
    connections?: DatabaseConnectionSummary[];
    onOpenTable?: (tableName: string) => void;
    /** Changes when a deployment completes: what the pipeline shows may be stale. */
    refreshKey?: number;
    /** The fingerprint of the schema as it is now: the pipeline follows it. */
    schemaHash?: string;
    /** The tables of the schema as it is now: offered when choosing which to ignore in the watch. */
    tableNames?: string[];
    /** Selects one of the project's databases for deployment. */
    onDeployTo?: (connectionId: string) => void;
    /** The project's `deploy` level or above: without it the plan can be read, not applied. */
    canDeploy: boolean;
    /** The project's administrators: the watch's settings are theirs. */
    canManage: boolean;
    canSkipStage?: boolean;
    onDeployed?: () => void;
    onShowProblems?: () => void;
    /** Changes when the server says a review request was made, decided or closed. */
    reviewsKey?: number;
  } = $props();

  const { t } = useTranslation();
  /** Counts the requests made from the dialog below: the card lists one more. */
  let requested = $state(0);
</script>

<div class="min-h-0 flex-1 overflow-y-auto bg-bg">
  <div class="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
    {#if !connection}
      <EmptyState>{t("workspace.deployments.noConnection")}</EmptyState>
    {:else}
      <div class="flex flex-wrap items-center gap-2">
        <Icon icon={DatabaseIcon} size={16} class="text-text-muted" />
        <h2 class="m-0 text-heading font-bold text-text">{connection.name}</h2>
        <Badge tone="admin">{t(`connections.engine.${connection.engine}`)}</Badge>
        {#if connection.environment}
          <EnvironmentBadge
            name={connection.environment}
            color={connection.environmentColor}
            production={connection.production}
          />
        {/if}
        <span class="flex-1"></span>
      </div>
      <DeploymentPanel
        {projectId}
        {schemaHash}
        initialConnectionId={connection.id}
        readOnly={!canDeploy}
        {canSkipStage}
        {onDeployed}
        {onShowProblems}
        onReviewRequested={() => (requested += 1)}
      />
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
      <MonitoringCard {projectId} {canManage} canCheck={canDeploy} {tableNames} />
      {#if connections.length > 1}
        <CompareEnvironmentsCard {projectId} {connections} currentId={connection.id} {onOpenTable} />
      {/if}
    {/if}
  </div>
</div>
