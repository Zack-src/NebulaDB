<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon, CodeIcon, TableIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { DeploymentFailure } from "./deploymentFailure";

  /**
   * A deployment the database refused: which statement of the script, what the database said, the statement
   * itself, and — when it names a table the diagram has — a way to the table and to its code to fix it where it is.
   */
  let {
    failure,
    onShowInGraph,
    onShowInCode,
    tableExists = () => true,
  }: {
    failure: DeploymentFailure;
    onShowInGraph?: (tableName: string, fieldName?: string) => void;
    onShowInCode?: (tableName: string) => void;
    tableExists?: (tableName: string) => boolean;
  } = $props();

  const { t } = useTranslation();
  const table = $derived(failure.table && tableExists(failure.table) ? failure.table : undefined);
</script>

<div
  role="alert"
  class="space-y-2 rounded-sm border border-danger bg-danger-light p-3 text-xs"
  data-testid="deploy-failure"
>
  <div class="flex items-start gap-2">
    <Icon icon={AlertTriangleIcon} size={14} class="mt-0.5 shrink-0 text-danger" />
    <div class="min-w-0 flex-1 space-y-1">
      <p class="m-0 font-semibold text-danger">
        {t("deployment.failedAt", { index: failure.index, total: failure.total })}
      </p>
      {#if failure.table}
        <p class="m-0 text-text">
          {t("deployment.failedOn")}
          <span class="font-mono font-semibold">
            {failure.column ? `${failure.table}.${failure.column}` : failure.table}
          </span>
        </p>
      {/if}
      <p class="m-0 break-words text-text">{failure.reason}</p>
    </div>
  </div>
  <pre
    class="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-surface p-2 font-mono text-caption text-text">{failure.statement}</pre>
  {#if table && (onShowInGraph || onShowInCode)}
    <div class="flex flex-wrap gap-1.5">
      {#if onShowInGraph}
        <Button size="xs" variant="outline" onclick={() => onShowInGraph(table, failure.column)}>
          <Icon icon={TableIcon} size={12} />
          {t("deployment.showInGraph")}
        </Button>
      {/if}
      {#if onShowInCode}
        <Button size="xs" variant="outline" onclick={() => onShowInCode(table)}>
          <Icon icon={CodeIcon} size={12} />
          {t("deployment.showInCode")}
        </Button>
      {/if}
    </div>
  {/if}
</div>
