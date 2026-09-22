<script lang="ts" module>
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import type { TranslationKey } from "@/i18n/translate";
  import { PuzzleIcon, SparklesIcon, CodeIcon, LayersIcon } from "@/components/icons/Icons";

  type ManagerTab = "marketplace" | "installed" | "studio" | "logs";
  type CategoryFilter = "all" | "export" | "import" | "canvas" | "editor" | "tools" | "community";

  const TABS: { id: ManagerTab; icon: IconDefinition; labelKey: TranslationKey }[] = [
    { id: "marketplace", icon: SparklesIcon, labelKey: "plugins.marketplace" },
    { id: "installed", icon: PuzzleIcon, labelKey: "plugins.myPlugins" },
    { id: "studio", icon: CodeIcon, labelKey: "plugins.studio" },
    { id: "logs", icon: LayersIcon, labelKey: "plugins.logs" },
  ];

  const CATEGORIES: { id: CategoryFilter; labelKey: TranslationKey }[] = [
    { id: "all", labelKey: "plugins.filterAll" },
    { id: "export", labelKey: "plugins.filterExport" },
    { id: "import", labelKey: "plugins.filterImport" },
    { id: "canvas", labelKey: "plugins.filterCanvas" },
    { id: "editor", labelKey: "plugins.filterEditor" },
    { id: "tools", labelKey: "plugins.filterTools" },
    { id: "community", labelKey: "plugins.filterCommunity" },
  ];

  const DEFAULT_STARTER_CODE = `athanor.plugin({
  id: "me.custom-action",
  name: "Action Personnalisée",
  version: "1.0.0",
  author: "Moi",
  category: "canvas",
  description: "Description de mon plugin",
  contributions: [
    {
      kind: "canvasCommand",
      id: "my-action",
      label: "Exécuter mon action",
      description: "Transformation personnalisée du schéma",
    },
  ],
});

athanor.on("canvasCommand:my-action", (project) => {
  console.log("Exécution sur le projet :", project.name);
  return { message: "Action exécutée avec succès !" };
});
`;
</script>

<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { SearchIcon, CloseIcon } from "@/components/icons/Icons";
  import { pluginRegistry } from "@/features/plugins/registry";
  import { COMMUNITY_TEMPLATES } from "@/features/plugins/communityTemplates";
  import { usePlugins } from "@/features/plugins/plugins.svelte";
  import type { PluginManifest, Contribution, PluginRecord, PluginSettingDef } from "@/features/plugins/types";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { triggerDownload } from "@/utils/download";
  import MarketplaceTab, { type MarketplaceItem } from "./dialog/MarketplaceTab.svelte";
  import InstalledTab from "./dialog/InstalledTab.svelte";
  import StudioTab from "./dialog/StudioTab.svelte";
  import LogsTab from "./dialog/LogsTab.svelte";
  import PluginSettingsModal from "./dialog/PluginSettingsModal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const { t } = useTranslation();
  const plugins = usePlugins();
  const records = $derived(plugins.records);

  let activeTab = $state<ManagerTab>("marketplace");
  let selectedCategory = $state<CategoryFilter>("all");
  let searchQuery = $state("");

  // Studio state
  let studioCode = $state(DEFAULT_STARTER_CODE);
  let studioBusy = $state(false);
  let studioError = $state<string | null>(null);
  let studioSuccess = $state.raw<{ manifest: PluginManifest; contributions: Contribution[] } | null>(null);

  // Settings configuration modal state
  let configuringPlugin = $state.raw<{ id: string; name: string; settings: PluginSettingDef[] } | null>(null);

  const installedMap = $derived(new Map(records.map((r) => [r.manifest.id, r] as const)));

  // Install template / code handler
  async function handleInstall(code: string) {
    studioBusy = true;
    studioError = null;
    try {
      await pluginRegistry.install(code);
      activeTab = "installed";
    } catch (err) {
      studioError = err instanceof Error ? err.message : String(err);
      activeTab = "studio";
    } finally {
      studioBusy = false;
    }
  }

  // Dry run test in Studio
  async function handleTestStudioCode() {
    studioBusy = true;
    studioError = null;
    studioSuccess = null;
    try {
      studioSuccess = await pluginRegistry.validate(studioCode);
    } catch (err) {
      studioError = err instanceof Error ? err.message : String(err);
    } finally {
      studioBusy = false;
    }
  }

  async function handleSaveStudioPlugin() {
    studioBusy = true;
    studioError = null;
    try {
      await pluginRegistry.install(studioCode);
      studioSuccess = null;
      activeTab = "installed";
    } catch (err) {
      studioError = err instanceof Error ? err.message : String(err);
    } finally {
      studioBusy = false;
    }
  }

  function handleDownloadSource(record: PluginRecord) {
    if (!record.code) return;
    const blob = new Blob([record.code], { type: "text/javascript" });
    const slug = record.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    triggerDownload(URL.createObjectURL(blob), `${slug}.js`, true);
  }

  function openStudioWith(code: string) {
    studioCode = code;
    activeTab = "studio";
  }

  // Filtered Marketplace items (Builtins + Community Templates)
  const marketplaceItems = $derived.by((): MarketplaceItem[] => {
    const q = searchQuery.toLowerCase().trim();

    const builtins: MarketplaceItem[] = records
      .filter((r) => r.source === "builtin")
      .map((r) => ({
        id: r.manifest.id,
        name: r.manifest.name,
        version: r.manifest.version ?? "1.0.0",
        author: r.manifest.author ?? "AthanorDB",
        category: r.manifest.category ?? "tools",
        description: r.manifest.description ?? "",
        tags: r.manifest.tags ?? [],
        source: "builtin" as const,
        record: r,
        template: null,
      }));

    const community: MarketplaceItem[] = COMMUNITY_TEMPLATES.map((tmpl) => ({
      id: tmpl.id,
      name: tmpl.name,
      version: tmpl.version,
      author: tmpl.author,
      category: tmpl.category,
      description: tmpl.description,
      tags: tmpl.tags,
      source: "community" as const,
      record: installedMap.get(tmpl.id) || null,
      template: tmpl,
    }));

    return [...builtins, ...community].filter((item) => {
      if (selectedCategory !== "all") {
        if (selectedCategory === "community" && item.source !== "community") return false;
        if (selectedCategory !== "community" && item.category !== selectedCategory) return false;
      }
      if (!q) return true;
      const matchName = item.name.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchAuthor = item.author.toLowerCase().includes(q);
      const matchTags = item.tags.some((tag) => tag.toLowerCase().includes(q));
      return matchName || matchDesc || matchAuthor || matchTags;
    });
  });

  // Filtered Installed plugins
  const filteredInstalled = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    return records.filter((r) => {
      if (selectedCategory !== "all") {
        if (selectedCategory === "community" && r.source === "builtin") return false;
        if (selectedCategory !== "community" && r.manifest.category && r.manifest.category !== selectedCategory) {
          return false;
        }
      }
      if (!q) return true;
      return (
        r.manifest.name.toLowerCase().includes(q) ||
        (r.manifest.description && r.manifest.description.toLowerCase().includes(q))
      );
    });
  });

  // All logs across hosts — re-read whenever the registry changes.
  const allLogs = $derived.by(() => {
    void records;
    return pluginRegistry.getAllLogs();
  });
</script>

<Modal title={t("editor.plugins")} {onClose} wide>
  <div class="flex flex-col gap-4">
    <!-- Navigation Tabs Header -->
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div class="flex items-center gap-1.5 rounded-lg bg-surface-raised p-1">
        {#each TABS as tab (tab.id)}
          <button
            type="button"
            onclick={() => (activeTab = tab.id)}
            class={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-text-on-accent shadow-xs"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            }`}
          >
            <Icon icon={tab.icon} size={13} />
            <span>{t(tab.labelKey)}</span>
            {#if tab.id === "installed"}
              <span class="rounded-full bg-surface px-1.5 py-0.2 text-[10px] text-text">{records.length}</span>
            {/if}
            {#if tab.id === "logs" && allLogs.length > 0}
              <span class="rounded-full bg-primary-light px-1.5 py-0.2 text-[10px] font-bold text-primary">
                {allLogs.length}
              </span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Search bar on Explorer & Installed tabs -->
      {#if activeTab === "marketplace" || activeTab === "installed"}
        <div class="relative flex min-w-[220px] items-center">
          <Icon icon={SearchIcon} size={13} class="absolute left-2.5 text-text-muted" />
          <input
            type="text"
            placeholder={t("plugins.searchPlaceholder")}
            bind:value={searchQuery}
            class="w-full rounded-md border border-border bg-surface-raised py-1.5 pl-8 pr-3 text-xs text-text placeholder:text-text-muted focus:border-primary focus:outline-hidden"
          />
          {#if searchQuery}
            <button type="button" onclick={() => (searchQuery = "")} class="absolute right-2 text-text-muted hover:text-text">
              <Icon icon={CloseIcon} size={12} />
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Category Filters (on marketplace & installed tabs) -->
    {#if activeTab === "marketplace" || activeTab === "installed"}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="mr-1 text-[11px] font-medium text-text-muted">{t("plugins.filters")}</span>
        {#each CATEGORIES as cat (cat.id)}
          <button
            type="button"
            onclick={() => (selectedCategory = cat.id)}
            class={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              selectedCategory === cat.id
                ? "bg-primary-light text-primary border border-primary/40 font-semibold"
                : "bg-surface-raised text-text-secondary border border-border hover:bg-surface-hover hover:text-text"
            }`}
          >
            {t(cat.labelKey)}
          </button>
        {/each}
      </div>
    {/if}

    {#if activeTab === "marketplace"}
      <MarketplaceTab
        items={marketplaceItems}
        {studioBusy}
        onInstallTemplate={handleInstall}
        onInspectCode={openStudioWith}
        onOpenSettings={(plugin) => (configuringPlugin = plugin)}
      />
    {:else if activeTab === "installed"}
      <InstalledTab
        records={filteredInstalled}
        onOpenStudioWithCode={openStudioWith}
        onCreateNew={() => (activeTab = "studio")}
        onDownloadSource={handleDownloadSource}
        onOpenSettings={(plugin) => (configuringPlugin = plugin)}
      />
    {:else if activeTab === "studio"}
      <StudioTab
        code={studioCode}
        busy={studioBusy}
        error={studioError}
        validationSuccess={studioSuccess}
        onChangeCode={(newCode) => {
          studioCode = newCode;
          studioError = null;
          studioSuccess = null;
        }}
        onTestCode={handleTestStudioCode}
        onSavePlugin={handleSaveStudioPlugin}
      />
    {:else}
      <LogsTab logs={allLogs} />
    {/if}
  </div>

  {#if configuringPlugin}
    <PluginSettingsModal
      pluginId={configuringPlugin.id}
      pluginName={configuringPlugin.name}
      settings={configuringPlugin.settings}
      onClose={() => (configuringPlugin = null)}
    />
  {/if}
</Modal>
