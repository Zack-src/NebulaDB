import { PuzzleIcon, PlusIcon, CodeIcon, SettingsIcon, SearchIcon } from "@/components/icons/Icons";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Hint } from "@/components/ui/Alert";
import { pluginRegistry } from "@/features/plugins/registry";
import type { PluginRecord, PluginSettingDef } from "@/features/plugins/types";
import type { CommunityTemplate } from "@/features/plugins/communityTemplates";
import { useTranslation } from "@/i18n/useTranslation";
import { ContributionBadges } from "./ContributionBadges";

export interface MarketplaceItem {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  tags: string[];
  source: "builtin" | "community";
  record: PluginRecord | null;
  template: CommunityTemplate | null;
}

export function MarketplaceTab({
  items,
  studioBusy,
  onInstallTemplate,
  onInspectCode,
  onOpenSettings,
}: {
  items: MarketplaceItem[];
  studioBusy: boolean;
  onInstallTemplate: (sourceCode: string) => void;
  onInspectCode: (sourceCode: string) => void;
  onOpenSettings: (plugin: { id: string; name: string; settings: PluginSettingDef[] }) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <Hint>{t("plugins.securityNote")}</Hint>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const isInstalled = Boolean(item.record);
          const isBuiltin = item.source === "builtin";
          const hasSettings = Boolean(
            item.record?.manifest.settings?.length || item.template?.sourceCode.includes("settings:"),
          );

          return (
            <div
              key={item.id}
              className="flex flex-col justify-between rounded-xl border border-border bg-surface-raised/40 p-3.5 transition-all duration-150 hover:border-border-strong hover:bg-surface-raised/80 hover:shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                      <PuzzleIcon size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-text">{item.name}</span>
                        <span className="text-[10px] text-text-muted">v{item.version}</span>
                      </div>
                      <span className="text-[10.5px] text-text-muted">par {item.author}</span>
                    </div>
                  </div>

                  <div>
                    {isBuiltin ? (
                      <Badge tone="muted">{t("plugins.builtin")}</Badge>
                    ) : isInstalled ? (
                      <Badge tone="success">{t("plugins.installed")}</Badge>
                    ) : (
                      <Badge tone="admin">{t("plugins.community")}</Badge>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-[11.5px] leading-relaxed text-text-secondary">{item.description}</p>

                {item.record && <ContributionBadges contributions={item.record.contributions} />}
              </div>

              <div className="mt-3.5 flex items-center justify-between border-t border-border/60 pt-2.5">
                {isInstalled ? (
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                        checked={item.record?.enabled}
                        onChange={(e) => pluginRegistry.setEnabled(item.record!.manifest.id, e.target.checked)}
                      />
                      <span>{item.record?.enabled ? t("plugins.enabled") : t("plugins.disabled")}</span>
                    </label>

                    {hasSettings && item.record && item.record.manifest.settings && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          onOpenSettings({
                            id: item.record!.manifest.id,
                            name: item.record!.manifest.name,
                            settings: item.record!.manifest.settings || [],
                          })
                        }
                        data-tooltip={t("common.settings")}
                      >
                        <SettingsIcon size={13} />
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => item.template && onInstallTemplate(item.template.sourceCode)}
                    disabled={studioBusy}
                  >
                    <PlusIcon size={12} /> {t("plugins.installOneClick")}
                  </Button>
                )}

                {item.template && (
                  <Button variant="ghost" size="sm" onClick={() => onInspectCode(item.template!.sourceCode)}>
                    <CodeIcon size={12} /> {t("plugins.viewCode")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center text-text-muted">
          <SearchIcon size={24} className="mb-2 text-text-muted/60" />
          <span className="text-xs font-semibold text-text">{t("plugins.noResults")}</span>
        </div>
      )}
    </div>
  );
}
