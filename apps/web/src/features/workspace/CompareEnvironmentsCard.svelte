<script lang="ts">
  import type { DatabaseConnectionSummary } from "@nebuladb/shared";
  import Badge, { type BadgeTone } from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { compareProjectConnections, type EnvironmentComparison } from "@/services/connectionsApi";
  import { canCompare, comparisonPair, countByStatus, detailRows } from "./compareEnvironments";

  /**
   * "Comparer deux environnements": two of the project's databases read now
   * and set side by side — what one has that the other lacks, table by table,
   * and what exists in a database without being in the schema at all.
   */
  let {
    projectId,
    connections,
    currentId,
    onShowInGraph,
  }: {
    projectId: string;
    connections: DatabaseConnectionSummary[];
    /** The workspace's current connection: the comparison's target by default. */
    currentId: string | null;
    /** Centres the diagram on a table the schema has. */
    onShowInGraph?: (tableName: string) => void;
  } = $props();

  const { t } = useTranslation();
  const options = $derived(
    connections.map((connection) => ({
      value: connection.id,
      label: connection.name,
      hint: [t(`connections.engine.${connection.engine}`), connection.environment].filter(Boolean).join(" · "),
    })),
  );
  let targetChoice = $state<string | null>(null);
  let sourceChoice = $state<string | null>(null);
  const pair = $derived(
    comparisonPair(
      connections.map((connection) => connection.id),
      currentId,
      { source: sourceChoice, target: targetChoice },
    ),
  );
  const sourceId = $derived(pair.sourceId);
  const targetId = $derived(pair.targetId);

  let comparison = $state.raw<EnvironmentComparison | null>(null);
  const compare = useAsyncAction(async () => {
    comparison = null;
    comparison = await compareProjectConnections(projectId, sourceId, targetId);
  });

  const STATUS_TONE: Record<EnvironmentComparison["tables"][number]["status"], BadgeTone> = {
    "only-source": "admin",
    "only-target": "warning",
    different: "muted",
  };
  const statusLabel = (entry: EnvironmentComparison["tables"][number], result: EnvironmentComparison) =>
    entry.status === "different"
      ? t("compareEnv.different")
      : t("compareEnv.onlyIn", { name: entry.status === "only-source" ? result.source.name : result.target.name });
</script>

<section
  class="rounded-md border border-border bg-surface p-3 text-xs"
  aria-labelledby="compare-env-title"
  data-testid="compare-environments"
>
  <h3 id="compare-env-title" class="m-0 mb-2 text-body-sm font-semibold text-text">{t("compareEnv.title")}</h3>
  <Hint>{t("compareEnv.hint")}</Hint>
  <div class="mt-2 flex flex-wrap items-center gap-2">
    <Select
      size="sm"
      class="w-52"
      aria-label={t("compareEnv.source")}
      value={sourceId}
      {options}
      onChange={(id) => (sourceChoice = id)}
    />
    <span class="text-text-muted">⇄</span>
    <Select
      size="sm"
      class="w-52"
      aria-label={t("compareEnv.target")}
      value={targetId}
      {options}
      onChange={(id) => (targetChoice = id)}
    />
    <Button
      size="sm"
      variant="outline"
      disabled={compare.pending || !canCompare(sourceId, targetId)}
      onclick={() => void compare.run()}
    >
      {compare.pending ? t("common.loading") : t("compareEnv.run")}
    </Button>
  </div>
  {#if compare.error}<ErrorText>{compare.error}</ErrorText>{/if}

  {#if comparison}
    {@const result = comparison}
    {#if result.tables.length === 0}
      <p class="m-0 mt-3 text-success" role="status">
        {t("compareEnv.identical", { source: result.source.name, target: result.target.name })}
      </p>
    {:else}
      {@const counts = countByStatus(result.tables)}
      <p class="m-0 mt-3 text-text-secondary" role="status">
        {t("compareEnv.summary", {
          onlySource: counts["only-source"],
          source: result.source.name,
          onlyTarget: counts["only-target"],
          target: result.target.name,
          different: counts.different,
        })}
      </p>
      <ul class="m-0 mt-2 list-none p-0" aria-label={t("compareEnv.differences")}>
        {#each result.tables as entry (entry.name)}
          <li class="border-b border-border py-1.5 last:border-b-0" data-table={entry.name} data-status={entry.status}>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono font-semibold text-text">{entry.name}</span>
              <Badge tone={STATUS_TONE[entry.status]}>{statusLabel(entry, result)}</Badge>
              {#if !entry.inSchema}
                <Badge tone="danger">{t("compareEnv.outOfSchema")}</Badge>
              {:else if onShowInGraph}
                <Button size="xs" variant="ghost" class="ml-auto" onclick={() => onShowInGraph(entry.name)}>
                  {t("compareEnv.openInSchema")}
                </Button>
              {/if}
            </div>
            {#if detailRows(entry)}
              {@const detail = detailRows(entry)!}
              <ul class="m-0 mt-1 list-none space-y-0.5 p-0 pl-3 text-text-secondary">
                {#if detail.onlyInSource.length > 0}
                  <li>
                    {t("compareEnv.columnsOnlyIn", { name: result.source.name })}
                    <span class="font-mono">{detail.onlyInSource.join(", ")}</span>
                  </li>
                {/if}
                {#if detail.onlyInTarget.length > 0}
                  <li>
                    {t("compareEnv.columnsOnlyIn", { name: result.target.name })}
                    <span class="font-mono">{detail.onlyInTarget.join(", ")}</span>
                  </li>
                {/if}
                {#each detail.changed as column (column.name)}
                  <li>
                    <span class="font-mono font-semibold">{column.name}</span>
                    <span class="font-mono">{column.before}</span>
                    <span class="text-text-muted">→</span>
                    <span class="font-mono">{column.after}</span>
                  </li>
                {/each}
                {#each detail.flags as flag (flag)}<li>{t(`compareEnv.${flag}`)}</li>{/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
