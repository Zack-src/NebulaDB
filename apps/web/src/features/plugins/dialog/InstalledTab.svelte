<script lang="ts">
  import { PuzzleIcon, PlusIcon, CodeIcon, SettingsIcon, DownloadIcon, TrashIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { pluginRegistry } from "@/features/plugins/registry";
  import type { PluginRecord, PluginSettingDef } from "@/features/plugins/types";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import ContributionBadges from "./ContributionBadges.svelte";

  let {
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
  } = $props();

  const { t } = useTranslation();
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center justify-between">
    <span class="text-xs font-semibold text-text">{t("plugins.pluginsCount", { count: records.length })}</span>
    <Button variant="primary" size="sm" onclick={onCreateNew}>
      <Icon icon={PlusIcon} size={12} />
      {t("plugins.add")}
    </Button>
  </div>

  <div class="flex flex-col gap-2">
    {#each records as record (record.manifest.id)}
      {@const hasSettings = record.manifest.settings && record.manifest.settings.length > 0}
      <div
        class="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised/50 p-3.5 transition-colors hover:border-border-strong"
      >
        <div class="flex items-center gap-2">
          <div class="flex h-7 w-7 items-center justify-center rounded-md bg-surface border border-border text-primary">
            <Icon icon={PuzzleIcon} size={14} />
          </div>
          <span class="text-xs font-bold text-text">{record.manifest.name}</span>
          {#if record.manifest.version}<span class="text-[10px] text-text-muted">v{record.manifest.version}</span>{/if}
          <Badge tone={record.source === "builtin" ? "muted" : "success"}>
            {t(record.source === "builtin" ? "plugins.builtin" : "plugins.installed")}
          </Badge>
          <span class="flex-1"></span>

          <label class="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-text-muted">
            <input
              type="checkbox"
              class="h-4 w-4 rounded accent-primary cursor-pointer"
              checked={record.enabled}
              onchange={(e) => pluginRegistry.setEnabled(record.manifest.id, e.currentTarget.checked)}
            />
            {t("plugins.enabled")}
          </label>

          {#if hasSettings}
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={() =>
                onOpenSettings({
                  id: record.manifest.id,
                  name: record.manifest.name,
                  settings: record.manifest.settings || [],
                })}
              data-tooltip={t("common.settings")}
            >
              <Icon icon={SettingsIcon} size={13} />
            </Button>
          {/if}

          {#if record.source === "user" && record.code}
            {@const code = record.code}
            <Button variant="ghost" size="icon-sm" onclick={() => onOpenStudioWithCode(code)} data-tooltip={t("plugins.studio")}>
              <Icon icon={CodeIcon} size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={() => onDownloadSource(record)}
              data-tooltip={t("plugins.downloadSource")}
            >
              <Icon icon={DownloadIcon} size={13} />
            </Button>
            <Button
              variant="danger-ghost"
              size="icon-sm"
              onclick={() => pluginRegistry.uninstall(record.manifest.id)}
              data-tooltip={t("plugins.uninstall")}
            >
              <Icon icon={TrashIcon} size={13} />
            </Button>
          {/if}
        </div>

        {#if record.manifest.description}
          <p class="text-[11.5px] text-text-muted">{record.manifest.description}</p>
        {/if}

        <ContributionBadges contributions={record.contributions} />

        {#if record.error}<ErrorText>{record.error}</ErrorText>{/if}
      </div>
    {/each}

    {#if records.length === 0}
      <div
        class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center text-text-muted"
      >
        <Icon icon={PuzzleIcon} size={20} class="mb-2 text-text-muted/60" />
        <span class="text-xs font-semibold text-text">{t("plugins.noPluginsFound")}</span>
      </div>
    {/if}
  </div>
</div>
