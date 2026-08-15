import { useMemo, useState, useSyncExternalStore } from "react";
import { Modal } from "@/components/overlays/Modal";
import { PuzzleIcon, SparklesIcon, CodeIcon, LayersIcon, SearchIcon, CloseIcon } from "@/components/icons/Icons";
import { pluginRegistry } from "@/features/plugins/registry";
import { COMMUNITY_TEMPLATES } from "@/features/plugins/communityTemplates";
import type {
  PluginManifest,
  Contribution,
  PluginRecord,
  PluginSettingDef,
} from "@/features/plugins/types";
import { useTranslation } from "@/i18n/useTranslation";
import type { TranslationKey } from "@/i18n/translate";
import { triggerDownload } from "@/utils/download";
import { MarketplaceTab, type MarketplaceItem, InstalledTab, StudioTab, LogsTab, PluginSettingsModal } from "./dialog";

type ManagerTab = "marketplace" | "installed" | "studio" | "logs";
type CategoryFilter = "all" | "export" | "import" | "canvas" | "editor" | "tools" | "community";

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

export function PluginManagerDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const records = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot,
  );

  const [activeTab, setActiveTab] = useState<ManagerTab>("marketplace");
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Studio state
  const [studioCode, setStudioCode] = useState(DEFAULT_STARTER_CODE);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioSuccess, setStudioSuccess] = useState<{
    manifest: PluginManifest;
    contributions: Contribution[];
  } | null>(null);

  // Settings configuration modal state
  const [configuringPlugin, setConfiguringPlugin] = useState<{
    id: string;
    name: string;
    settings: PluginSettingDef[];
  } | null>(null);

  const installedMap = useMemo(() => {
    const map = new Map<string, PluginRecord>();
    for (const r of records) map.set(r.manifest.id, r);
    return map;
  }, [records]);

  // Install template / code handler
  const handleInstall = async (code: string) => {
    setStudioBusy(true);
    setStudioError(null);
    try {
      await pluginRegistry.install(code);
      setActiveTab("installed");
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
      setActiveTab("studio");
    } finally {
      setStudioBusy(false);
    }
  };

  // Dry run test in Studio
  const handleTestStudioCode = async () => {
    setStudioBusy(true);
    setStudioError(null);
    setStudioSuccess(null);
    try {
      const validated = await pluginRegistry.validate(studioCode);
      setStudioSuccess(validated);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setStudioBusy(false);
    }
  };

  const handleSaveStudioPlugin = async () => {
    setStudioBusy(true);
    setStudioError(null);
    try {
      await pluginRegistry.install(studioCode);
      setStudioSuccess(null);
      setActiveTab("installed");
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setStudioBusy(false);
    }
  };

  const handleDownloadSource = (record: PluginRecord) => {
    if (!record.code) return;
    const blob = new Blob([record.code], { type: "text/javascript" });
    const slug = record.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    triggerDownload(URL.createObjectURL(blob), `${slug}.js`, true);
  };

  // Filtered Marketplace items (Builtins + Community Templates)
  const marketplaceItems: MarketplaceItem[] = useMemo(() => {
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

    const all = [...builtins, ...community];

    return all.filter((item) => {
      if (selectedCategory !== "all") {
        if (selectedCategory === "community" && item.source !== "community") return false;
        if (selectedCategory !== "community" && item.category !== selectedCategory) return false;
      }
      if (!q) return true;
      const matchName = item.name.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchAuthor = item.author.toLowerCase().includes(q);
      const matchTags = item.tags.some((t) => t.toLowerCase().includes(q));
      return matchName || matchDesc || matchAuthor || matchTags;
    });
  }, [records, installedMap, searchQuery, selectedCategory]);

  // Filtered Installed plugins
  const filteredInstalled = useMemo(() => {
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
  }, [records, searchQuery, selectedCategory]);

  // All logs across hosts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allLogs = useMemo(() => pluginRegistry.getAllLogs(), [records]);

  return (
    <Modal title={t("editor.plugins")} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {/* Navigation Tabs Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-raised p-1">
            <button
              type="button"
              onClick={() => setActiveTab("marketplace")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "marketplace"
                  ? "bg-primary text-text-on-accent shadow-xs"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <SparklesIcon size={13} />
              <span>{t("plugins.marketplace")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("installed")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "installed"
                  ? "bg-primary text-text-on-accent shadow-xs"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <PuzzleIcon size={13} />
              <span>{t("plugins.myPlugins")}</span>
              <span className="rounded-full bg-surface px-1.5 py-0.2 text-[10px] text-text">{records.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("studio")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "studio"
                  ? "bg-primary text-text-on-accent shadow-xs"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <CodeIcon size={13} />
              <span>{t("plugins.studio")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "logs"
                  ? "bg-primary text-text-on-accent shadow-xs"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <LayersIcon size={13} />
              <span>{t("plugins.logs")}</span>
              {allLogs.length > 0 && (
                <span className="rounded-full bg-primary-light px-1.5 py-0.2 text-[10px] font-bold text-primary">
                  {allLogs.length}
                </span>
              )}
            </button>
          </div>

          {/* Search bar on Explorer & Installed tabs */}
          {(activeTab === "marketplace" || activeTab === "installed") && (
            <div className="relative flex min-w-[220px] items-center">
              <SearchIcon size={13} className="absolute left-2.5 text-text-muted" />
              <input
                type="text"
                placeholder={t("plugins.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-raised py-1.5 pl-8 pr-3 text-xs text-text placeholder:text-text-muted focus:border-primary focus:outline-hidden"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 text-text-muted hover:text-text"
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Category Filters (on marketplace & installed tabs) */}
        {(activeTab === "marketplace" || activeTab === "installed") && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium text-text-muted">{t("plugins.filters")}</span>
            {(
              [
                { id: "all", labelKey: "plugins.filterAll" },
                { id: "export", labelKey: "plugins.filterExport" },
                { id: "import", labelKey: "plugins.filterImport" },
                { id: "canvas", labelKey: "plugins.filterCanvas" },
                { id: "editor", labelKey: "plugins.filterEditor" },
                { id: "tools", labelKey: "plugins.filterTools" },
                { id: "community", labelKey: "plugins.filterCommunity" },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  selectedCategory === cat.id
                    ? "bg-primary-light text-primary border border-primary/40 font-semibold"
                    : "bg-surface-raised text-text-secondary border border-border hover:bg-surface-hover hover:text-text"
                }`}
              >
                {t(cat.labelKey as TranslationKey)}
              </button>
            ))}
          </div>
        )}

        {/* TAB 1: MARKETPLACE / EXPLORER */}
        {activeTab === "marketplace" && (
          <MarketplaceTab
            items={marketplaceItems}
            studioBusy={studioBusy}
            onInstallTemplate={handleInstall}
            onInspectCode={(code) => {
              setStudioCode(code);
              setActiveTab("studio");
            }}
            onOpenSettings={setConfiguringPlugin}
          />
        )}

        {/* TAB 2: INSTALLED PLUGINS */}
        {activeTab === "installed" && (
          <InstalledTab
            records={filteredInstalled}
            onOpenStudioWithCode={(code) => {
              setStudioCode(code);
              setActiveTab("studio");
            }}
            onCreateNew={() => setActiveTab("studio")}
            onDownloadSource={handleDownloadSource}
            onOpenSettings={setConfiguringPlugin}
          />
        )}

        {/* TAB 3: STUDIO & PLUGIN CREATOR */}
        {activeTab === "studio" && (
          <StudioTab
            code={studioCode}
            busy={studioBusy}
            error={studioError}
            validationSuccess={studioSuccess}
            onChangeCode={(newCode) => {
              setStudioCode(newCode);
              setStudioError(null);
              setStudioSuccess(null);
            }}
            onTestCode={handleTestStudioCode}
            onSavePlugin={handleSaveStudioPlugin}
          />
        )}

        {/* TAB 4: CONSOLE & LOGS */}
        {activeTab === "logs" && <LogsTab logs={allLogs} />}
      </div>

      {/* Settings Modal Popover */}
      {configuringPlugin && (
        <PluginSettingsModal
          pluginId={configuringPlugin.id}
          pluginName={configuringPlugin.name}
          settings={configuringPlugin.settings}
          onClose={() => setConfiguringPlugin(null)}
        />
      )}
    </Modal>
  );
}

export default PluginManagerDialog;
