<script lang="ts">
  import type { DatabaseConnectionSummary } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, SparklesIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import DeploymentsTab from "./DeploymentsTab.svelte";

  /** The deployment panel beside the diagram: see `DeploymentDrawerState`. */
  let {
    projectId,
    connection,
    connections,
    refreshKey,
    reviewsKey,
    schemaHash,
    canDeploy,
    canSkipStage,
    onDeployTo,
    onOpenConnectionsAdmin,
    onDeployed,
    onShowProblems,
    onShowInGraph,
    onShowInCode,
    onClose,
  }: {
    projectId: string;
    connection: DatabaseConnectionSummary | null;
    connections: DatabaseConnectionSummary[];
    refreshKey: number;
    reviewsKey: number;
    schemaHash?: string;
    canDeploy: boolean;
    canSkipStage: boolean;
    onDeployTo: (connectionId: string) => void;
    onOpenConnectionsAdmin?: () => void;
    onDeployed: () => void;
    onShowProblems: () => void;
    /** Centres the diagram on a table (and a column). */
    onShowInGraph: (tableName: string, fieldName?: string) => void;
    /** Scrolls the DBML code to a table. */
    onShowInCode: (tableName: string) => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<section class="flex min-h-0 flex-1 flex-col bg-surface" aria-label={t("workspace.deployments.title")}>
  <header class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
    <Icon icon={SparklesIcon} size={14} class="text-text-muted" />
    <span class="text-body-sm font-semibold text-text">{t("workspace.deployments.title")}</span>
    <span class="flex-1"></span>
    <Button variant="ghost" size="icon-xs" onclick={onClose} data-tooltip={t("common.close")}>
      <Icon icon={CloseIcon} size={12} />
    </Button>
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <!-- Keyed on the database: the analysis it holds is for that one. -->
    {#key connection?.id}
    <DeploymentsTab
      compact
      {projectId}
      {connection}
      {connections}
      {refreshKey}
      {reviewsKey}
      {schemaHash}
      {onDeployTo}
      {canDeploy}
      {canSkipStage}
      {onOpenConnectionsAdmin}
      {onDeployed}
      {onShowProblems}
      {onShowInGraph}
      {onShowInCode}
    />
    {/key}
  </div>
</section>
