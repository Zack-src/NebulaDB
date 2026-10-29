<script lang="ts">
  import Badge from "@/components/ui/Badge.svelte";
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import { APP_HEADER, APP_SHELL } from "@/components/ui/layout";
  import { formatDate } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import DiagramViewer from "./DiagramViewer.svelte";
  import SharedDictionary from "./SharedDictionary.svelte";
  import {
    ShareUnavailableError,
    fetchSharedDiagram,
    fetchSharedView,
    shareTokenFromPath,
    type SharedView,
  } from "./publicShareApi";

  /**
   * `/share/<token>`: a project's schema for someone with no account, read-only
   * and as it is now. Started by `main.ts` instead of the app, so none of the
   * app runs here — no session check, no project list, no WebSocket — and the
   * only requests are the two in `publicShareApi.ts`.
   */
  const { t } = useTranslation();
  const token = shareTokenFromPath(window.location.pathname);

  type Tab = "diagram" | "dictionary";
  let shared = $state.raw<SharedView | null>(null);
  let svg = $state<string | null>(null);
  let failure = $state<ShareUnavailableError["reason"] | null>(token ? null : "not-found");
  let tab = $state<Tab>("diagram");

  $effect(() => {
    if (!token) return;
    void (async () => {
      try {
        const view = await fetchSharedView(token);
        shared = view;
        tab = view.shows === "dictionary" ? "dictionary" : "diagram";
        if (view.shows !== "dictionary") svg = await fetchSharedDiagram(token);
      } catch (err) {
        failure = err instanceof ShareUnavailableError ? err.reason : "network";
      }
    })();
  });

  $effect(() => {
    document.title = shared ? `${shared.projectName} — NebulaDB` : "NebulaDB";
  });

  const tabs = $derived<{ value: Tab; label: string }[]>([
    { value: "diagram", label: t("share.tab.diagram") },
    { value: "dictionary", label: t("share.tab.dictionary") },
  ]);
  const FAILURE_KEY = {
    "not-found": "share.unavailable",
    "rate-limited": "share.rateLimited",
    network: "share.network",
  } as const;
</script>

<svelte:head>
  <!-- The server sends both as headers; repeated here for a dev server that does not. -->
  <meta name="referrer" content="no-referrer" />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class={APP_SHELL}>
  <header class={APP_HEADER}>
    <BrandMark size={24} iconSize={13} />
    <span class="truncate text-body font-semibold" data-testid="share-project-name">{shared?.projectName ?? ""}</span>
    {#if shared}
      <Badge tone="muted">{t("share.readOnly")}</Badge>
      <span class="hidden text-caption text-text-muted sm:inline">
        {t("share.expiresOn", { date: formatDate(shared.expiresAt, i18n.locale) })}
      </span>
    {/if}
    <span class="flex-1"></span>
    {#if shared?.shows === "both"}
      <SegmentedControl size="sm" bind:value={tab} options={tabs} aria-label={t("share.tabsLabel")} />
    {/if}
  </header>

  <main class="flex min-h-0 flex-1 flex-col">
    {#if failure}
      <div class="m-auto max-w-md p-6">
        <EmptyState>{t(FAILURE_KEY[failure])}</EmptyState>
      </div>
    {:else if !shared}
      <div class="m-auto p-6 text-xs text-text-muted">{t("common.loading")}</div>
    {:else if tab === "dictionary" && shared.dictionary}
      <SharedDictionary dictionary={shared.dictionary} />
    {:else if svg}
      <DiagramViewer {svg} name={shared.projectName} />
    {:else}
      <div class="m-auto p-6 text-xs text-text-muted">{t("common.loading")}</div>
    {/if}
  </main>
</div>
