<script lang="ts">
  import type { DatabaseConnectionSummary } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { DatabaseIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import DeploymentPanel from "@/features/connections/deployment/DeploymentPanel.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import DeploymentReviewsCard from "./DeploymentReviewsCard.svelte";
  import PipelineCard from "./PipelineCard.svelte";

  /** Deployment planning, application and pipeline for the project. */
  let {
    projectId,
    connection,
    connections = [],
    refreshKey = 0,
    schemaHash,
    onDeployTo = () => {},
    canDeploy,
    canSkipStage = false,
    onOpenConnectionsAdmin,
    onDeployed = () => {},
    onShowProblems,
    reviewsKey = 0,
  }: {
    projectId: string;
    /** The workspace's current connection; `null` when the project has none. */
    connection: DatabaseConnectionSummary | null;
    /** Every database of the project. */
    connections?: DatabaseConnectionSummary[];
    /** Changes when a deployment completes: what the pipeline shows may be stale. */
    refreshKey?: number;
    /** The fingerprint of the schema as it is now: the pipeline follows it. */
    schemaHash?: string;
    /** Selects one of the project's databases for deployment. */
    onDeployTo?: (connectionId: string) => void;
    /** The project's `deploy` level or above: without it the plan can be read, not applied. */
    canDeploy: boolean;
    canSkipStage?: boolean;
    /** Takes an instance administrator to Admin → Connections to attach a database. */
    onOpenConnectionsAdmin?: () => void;
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
      <EmptyState>
        <p class="m-0 mb-3">{t("workspace.deployments.noConnection")}</p>
        {#if onOpenConnectionsAdmin}
          <Button variant="outline" size="sm" onclick={onOpenConnectionsAdmin}>
            <Icon icon={DatabaseIcon} size={13} />
            {t("workspace.deployments.openConnections")}
          </Button>
        {:else}
          <p class="m-0">{t("workspace.deployments.noConnectionMember")}</p>
        {/if}
      </EmptyState>
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
    {/if}
  </div>
</div>
