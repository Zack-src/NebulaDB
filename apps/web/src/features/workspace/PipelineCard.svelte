<script lang="ts">
  import { untrack } from "svelte";
  import type { PipelineConnection, PipelineStage } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, LockIcon, RestoreIcon } from "@/components/icons/Icons";
  import Badge, { type BadgeTone } from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchProjectPipeline } from "@/services/connectionsApi";

  /**
   * "Pipeline": the project's databases along the chain of stages — which
   * have the schema as it is now, which are behind, and which stage has to
   * receive it before a guarded one will. The rule itself is the server's;
   * this shows it before the deployment dialog would refuse.
   */
  let {
    projectId,
    refreshKey = 0,
    canDeploy,
    onDeployTo,
  }: {
    projectId: string;
    /** Changes when a deployment may have happened. */
    refreshKey?: number;
    canDeploy: boolean;
    onDeployTo: (connectionId: string) => void;
  } = $props();

  const { t } = useTranslation();
  const pipeline = useAsyncResource(() => fetchProjectPipeline(projectId));
  let seenKey = untrack(() => refreshKey);
  $effect(() => {
    if (refreshKey !== seenKey) {
      seenKey = refreshKey;
      pipeline.reload();
    }
  });

  /** Only the stages the project has a database on: the others are not part of its pipeline. */
  const stages = $derived((pipeline.data?.stages ?? []).filter((stage) => stage.connections.length > 0));

  type State = "level" | "behind" | "failed" | "never";
  const stateOf = (connection: PipelineConnection): State =>
    connection.level
      ? "level"
      : !connection.lastDeployment
        ? "never"
        : connection.lastDeployment.success
          ? "behind"
          : "failed";
  const TONE: Record<State, BadgeTone> = { level: "success", behind: "warning", failed: "danger", never: "muted" };
  const when = (connection: PipelineConnection) =>
    connection.lastDeployment
      ? formatRelativeTime(parseServerTime(connection.lastDeployment.at), i18n.locale)
      : null;
  const blocked = (stage: PipelineStage) => !stage.ready && stage.connections.some((connection) => !connection.level);
</script>

{#if pipeline.error}
  <ErrorText>{pipeline.error}</ErrorText>
{:else if stages.length > 0}
  <section
    class="rounded-md border border-border bg-surface p-3 text-xs"
    aria-labelledby="pipeline-title"
    data-testid="pipeline"
  >
    <div class="mb-2 flex items-center gap-2">
      <h3 id="pipeline-title" class="m-0 flex-1 text-body-sm font-semibold text-text">{t("pipeline.title")}</h3>
      <Button size="xs" variant="ghost" disabled={pipeline.loading} onclick={() => pipeline.reload()}>
        <Icon icon={RestoreIcon} size={12} />
        {t("pipeline.refresh")}
      </Button>
    </div>
    <Hint>{t("pipeline.hint")}</Hint>
    <ol class="m-0 mt-2 flex list-none flex-wrap items-stretch gap-2 p-0" aria-label={t("pipeline.title")}>
      {#each stages as stage, index (stage.id)}
        {#if index > 0}
          <li class="flex items-center text-text-muted" aria-hidden="true">
            <Icon icon={ChevronRightIcon} size={14} />
          </li>
        {/if}
        <li
          class="flex min-w-[190px] flex-1 flex-col gap-2 rounded-sm border border-border bg-surface-raised p-2"
          data-stage={stage.name}
          data-ready={stage.ready}
        >
          <div class="flex items-center gap-2">
            <EnvironmentBadge name={stage.name} color={stage.color} production={stage.production} />
            {#if blocked(stage)}
              <span
                class="flex items-center gap-1 text-text-muted"
                data-tooltip={t("pipeline.waitsHint", { stage: stage.requires ?? "" })}
              >
                <Icon icon={LockIcon} size={11} />
                {t("pipeline.waits", { stage: stage.requires ?? "" })}
              </span>
            {/if}
          </div>
          {#each stage.connections as connection (connection.id)}
            {@const state = stateOf(connection)}
            <div class="flex flex-wrap items-center gap-2" data-connection={connection.name} data-state={state}>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold text-text">{connection.name}</span>
                {#if when(connection)}<span class="block text-text-muted">{when(connection)}</span>{/if}
              </span>
              <Badge tone={TONE[state]}>{t(`pipeline.state.${state}`)}</Badge>
              {#if canDeploy && !connection.level}
                <Button size="xs" variant="outline" onclick={() => onDeployTo(connection.id)}>
                  {t("deployment.deploy")}
                </Button>
              {/if}
            </div>
          {/each}
        </li>
      {/each}
    </ol>
  </section>
{/if}
