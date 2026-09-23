<script lang="ts" module>
  import type { SearchHit } from "@/services/searchApi";

  const DEBOUNCE_MS = 250;
  export const MIN_GLOBAL_QUERY = 2;

  /** Splits `text` around the first case-insensitive occurrence of `needle`, for highlighting. */
  function splitMatch(text: string, needle: string): [string, string, string] {
    const at = text.toLowerCase().indexOf(needle.toLowerCase());
    if (at < 0 || !needle) return [text, "", ""];
    return [text.slice(0, at), text.slice(at, at + needle.length), text.slice(at + needle.length)];
  }

  function groupByProject(hits: SearchHit[]): { projectId: string; projectName: string; hits: SearchHit[] }[] {
    const groups = new Map<string, { projectId: string; projectName: string; hits: SearchHit[] }>();
    for (const hit of hits) {
      let group = groups.get(hit.projectId);
      if (!group) {
        group = { projectId: hit.projectId, projectName: hit.projectName, hits: [] };
        groups.set(hit.projectId, group);
      }
      group.hits.push(hit);
    }
    return [...groups.values()];
  }
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { FolderIcon, TableIcon, TagIcon } from "@/components/icons/Icons";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { searchSchemas } from "@/services/searchApi";

  /**
   * "Find this table/column across all my projects" — the dashboard's search
   * box already filters project *names*; this section answers the same query
   * against their *contents*. Debounced and abortable: a fast typist fires one
   * request, and a stale response can never overwrite a newer one.
   */
  let { query, onOpenHit }: { query: string; onOpenHit: (hit: SearchHit) => void } = $props();

  const { t } = useTranslation();
  let hits = $state.raw<SearchHit[]>([]);
  let truncated = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let settledQuery = $state("");

  const needle = $derived(query.trim());

  $effect(() => {
    const q = needle;
    if (q.length < MIN_GLOBAL_QUERY) {
      hits = [];
      truncated = false;
      error = null;
      loading = false;
      settledQuery = "";
      return;
    }
    loading = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSchemas(q, controller.signal)
        .then((result) => {
          hits = result.hits;
          truncated = result.truncated;
          error = null;
          settledQuery = q;
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          error = describeApiError(err, t);
        })
        .finally(() => {
          if (!controller.signal.aborted) loading = false;
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const groups = $derived(groupByProject(hits));
</script>

{#if needle.length >= MIN_GLOBAL_QUERY}
  <section class="mt-8" aria-labelledby="global-search-title" data-testid="global-search">
    <h2 id="global-search-title" class="mb-3 flex items-center gap-2 text-sm font-bold">
      {t("projects.globalSearch.title")}
      {#if loading}<span class="text-xs font-normal text-text-muted">{t("common.loading")}</span>{/if}
    </h2>
    {#if error}
      <ErrorText>{error}</ErrorText>
    {:else if !loading && settledQuery && hits.length === 0}
      <p class="text-xs text-text-muted">{t("projects.globalSearch.empty", { query: settledQuery })}</p>
    {:else}
      <div class="flex flex-col gap-3">
        {#each groups as group (group.projectId)}
          <div class="rounded-lg border border-border bg-surface">
            <div class="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold">
              <Icon icon={FolderIcon} size={13} class="text-primary" />
              {group.projectName}
            </div>
            <ul class="list-none py-1">
              {#each group.hits as hit, i (i)}
                {@const label =
                  hit.kind === "field" ? `${hit.tableName}.${hit.fieldName}` : (hit.tableName ?? hit.enumName ?? "")}
                {@const matched = hit.kind === "field" ? (hit.fieldName ?? "") : label}
                {@const [before, match, after] = splitMatch(matched, needle)}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none disabled:cursor-default"
                    disabled={hit.kind === "enum"}
                    onclick={() => onOpenHit(hit)}
                  >
                    <Icon icon={hit.kind === "enum" ? TagIcon : TableIcon} size={12} class="shrink-0 text-text-muted" />
                    <span class="font-mono">
                      {#if hit.kind === "field"}<span class="text-text-muted">{hit.tableName}.</span>{/if}{before}<mark
                        class="rounded-sm bg-primary-light px-0.5 text-primary">{match}</mark
                      >{after}
                    </span>
                    {#if hit.kind === "field" && hit.fieldType}
                      <span class="font-mono text-[10px] text-text-muted">{hit.fieldType}</span>
                    {/if}
                    <span class="ml-auto text-[10px] text-text-muted">
                      {hit.kind === "table"
                        ? t("projects.globalSearch.kind.table")
                        : hit.kind === "field"
                          ? t("projects.globalSearch.kind.field")
                          : t("projects.globalSearch.kind.enum")}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
      {#if truncated}
        <p class="mt-2 text-xs text-text-muted">{t("projects.globalSearch.truncated")}</p>
      {/if}
    {/if}
  </section>
{/if}
