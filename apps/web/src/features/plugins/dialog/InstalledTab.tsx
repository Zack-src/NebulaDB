import { PuzzleIcon, PlusIcon, CodeIcon, SettingsIcon, DownloadIcon, TrashIcon } from "@/components/icons/Icons";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { pluginRegistry } from "@/features/plugins/registry";
import type { PluginRecord, PluginSettingDef } from "@/features/plugins/types";
import { useTranslation } from "@/i18n/useTranslation";
import { ContributionBadges } from "./ContributionBadges";

export function InstalledTab({
  records,
  onOpenStudioWithCode,
  onCreateNew,
  onDownloadSource,
  onOpenSettings,
}: {
  records: PluginRecord[];
  onOpenStudioWithCode: (code: string) => void;
  onCreateNew: () => void;
  onDownloadSource: (record: PluginRecord) => void;
  onOpenSettings: (plugin: { id: string; name: string; settings: PluginSettingDef[] }) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text">{t("plugins.pluginsCount", { count: records.length })}</span>
        <Button variant="primary" size="sm" onClick={onCreateNew}>
          <PlusIcon size={12} /> {t("plugins.add")}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {records.map((record) => {
          const hasSettings = record.manifest.settings && record.manifest.settings.length > 0;
          return (
            <div
              key={record.manifest.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised/50 p-3.5 transition-colors hover:border-border-strong"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface border border-border text-primary">
                  <PuzzleIcon size={14} />
                </div>
                <span className="text-xs font-bold text-text">{record.manifest.name}</span>
                {record.manifest.version && (
                  <span className="text-[10px] text-text-muted">v{record.manifest.version}</span>
                )}
                <Badge tone={record.source === "builtin" ? "muted" : "success"}>
                  {t(record.source === "builtin" ? "plugins.builtin" : "plugins.installed")}
                </Badge>
                <span className="flex-1" />

                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-text-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded accent-primary cursor-pointer"
                    checked={record.enabled}
                    onChange={(e) => pluginRegistry.setEnabled(record.manifest.id, e.target.checked)}
                  />
                  {t("plugins.enabled")}
                </label>

                {hasSettings && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      onOpenSettings({
                        id: record.manifest.id,
                        name: record.manifest.name,
                        settings: record.manifest.settings || [],
                      })
                    }
                    data-tooltip={t("common.settings")}
                  >
                    <SettingsIcon size={13} />
                  </Button>
                )}

                {record.source === "user" && record.code && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onOpenStudioWithCode(record.code!)}
                      data-tooltip={t("plugins.studio")}
                    >
                      <CodeIcon size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDownloadSource(record)}
                      data-tooltip={t("plugins.downloadSource")}
                    >
                      <DownloadIcon size={13} />
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="icon-sm"
                      onClick={() => pluginRegistry.uninstall(record.manifest.id)}
                      data-tooltip={t("plugins.uninstall")}
                    >
                      <TrashIcon size={13} />
                    </Button>
                  </>
                )}
              </div>

              {record.manifest.description && (
                <p className="text-[11.5px] text-text-muted">{record.manifest.description}</p>
              )}

              <ContributionBadges contributions={record.contributions} />

              {record.error && <ErrorText>{record.error}</ErrorText>}
            </div>
          );
        })}

        {records.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center text-text-muted">
            <PuzzleIcon size={20} className="mb-2 text-text-muted/60" />
            <span className="text-xs font-semibold text-text">{t("plugins.noPluginsFound")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
