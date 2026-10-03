<script lang="ts">
  import type { DatabaseConnectionSummary } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { DatabaseIcon, SparklesIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import DeploymentHistoryPanel from "@/features/connections/DeploymentHistoryPanel.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import MonitoringCard from "./MonitoringCard.svelte";

  /**
   * What was deployed to the current connection, and the two ways to act on
   * it: compare the schema with the database, or deploy. The history itself —
   * and its rollback — is the panel the deployment dialog already had; here it
   * has a page of its own instead of being the fifth step of a wizard.
   */
  let {
    projectId,
    connection,
    canDeploy,
    onDeploy,
    onShowDifferences,
  }: {
    projectId: string;
    /** The workspace's current connection; `null` when the project has none. */
    connection: DatabaseConnectionSummary | null;
    /** False for a view-only project: comparing stays, deploying goes. */
    canDeploy: boolean;
    onDeploy: () => void;
    onShowDifferences: () => void;
  } = $props();

  const { t } = useTranslation();
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
          <EnvironmentBadge name={connection.environment} color={connection.environmentColor} production={connection.production} />
        {/if}
        <span class="flex-1"></span>
        <Button size="sm" variant="outline" onclick={onShowDifferences}>{t("connections.checkDifferences")}</Button>
        {#if canDeploy}
          <Button size="sm" variant="primary" onclick={onDeploy}>
            <Icon icon={SparklesIcon} size={13} />
            {t("deployment.deploy")}
          </Button>
        {/if}
      </div>
      <!-- The watch covers all the project's databases, not only the current one. -->
      <MonitoringCard {projectId} canManage={canDeploy} />
      <!-- Keyed: the panel fetches once for the connection it was created with. -->
      {#key connection.id}
        <DeploymentHistoryPanel
          {projectId}
          connId={connection.id}
          engine={connection.engine}
          production={connection.production}
          connectionName={connection.name}
        />
      {/key}
    {/if}
  </div>
</div>
