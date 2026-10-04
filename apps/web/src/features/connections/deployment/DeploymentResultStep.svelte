<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckCircleIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { ApplyDeploymentResponse } from "@/services/connectionsApi";

  /**
   * Last step of the deployment dialog, once the deployment went through:
   * how many statements ran, the backup taken before, what happened to each
   * table's initial data, and what a rollback could not undo.
   */
  let {
    result,
    connectionName,
  }: {
    result: ApplyDeploymentResponse;
    connectionName: string;
  } = $props();

  const { t } = useTranslation();
</script>

<!-- Step 4: Done result -->
<div class="rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-6 text-center text-xs">
  <Icon icon={CheckCircleIcon} size={32} class="mx-auto mb-2 text-emerald-400" />
  <h3 class="text-base font-bold text-text">{t("deployment.deploySuccessTitle")}</h3>
  <p class="mt-1 text-text-muted">
    {t("deployment.deploySuccessDesc", {
      count: result.executedStatements,
      name: connectionName,
    })}
  </p>
  {#if result.backupId}
    <p class="mt-1 text-text-muted" data-testid="deploy-backup">{t("deployment.backupTaken")}</p>
  {/if}
  {#if result.seedReport.length > 0}
    <ul class="mt-3 space-y-0.5 text-left font-mono text-[11px]" data-testid="seed-report">
      {#each result.seedReport as seed (seed.tableName)}
        <li class={seed.error ? "text-danger" : "text-text"}>
          {seed.tableName} :
          {seed.error
            ? t("seeds.reportFailed", { error: seed.error })
            : seed.skipped
              ? t("seeds.reportSkipped")
              : t("seeds.reportInserted", { count: seed.inserted })}
        </li>
      {/each}
    </ul>
  {/if}
  {#if result.irreversibleWarnings.length > 0}
    <div class="mt-3 space-y-1 rounded-sm border border-amber-500/40 bg-amber-500/5 p-2.5 text-left text-[11px] text-amber-300">
      <p class="font-semibold">{t("deployment.rollbackIrreversibleTitle")}</p>
      <ul class="list-disc space-y-0.5 pl-4">
        {#each result.irreversibleWarnings as warning (warning)}
          <li>{warning}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
