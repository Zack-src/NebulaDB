<script lang="ts" module>
  import type { PluginRecord } from "@/features/plugins/types";
  import type { CommunityTemplate } from "@/features/plugins/communityTemplates";

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
</script>

<script lang="ts">
  import { PuzzleIcon, PlusIcon, CodeIcon, SettingsIcon, SearchIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { pluginRegistry } from "@/features/plugins/registry";
  import type { PluginSettingDef } from "@/features/plugins/types";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import ContributionBadges from "./ContributionBadges.svelte";

  let {
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
  } = $props();

  const { t } = useTranslation();
</script>

<div class="flex flex-col gap-3">
  <Hint>{t("plugins.securityNote")}</Hint>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {#each items as item (item.id)}
      {@const record = item.record}
      {@const template = item.template}
      {@const hasSettings = Boolean(record?.manifest.settings?.length || template?.sourceCode.includes("settings:"))}
      <div
        class="flex flex-col justify-between rounded-xl border border-border bg-surface-raised/40 p-3.5 transition-all duration-150 hover:border-border-strong hover:bg-surface-raised/80 hover:shadow-sm"
      >
        <div>
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2.5">
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20"
              >
                <Icon icon={PuzzleIcon} size={16} />
              </div>
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-bold text-text">{item.name}</span>
                  <span class="text-[10px] text-text-muted">v{item.version}</span>
                </div>
                <span class="text-[10.5px] text-text-muted">par {item.author}</span>
              </div>
            </div>

            <div>
              {#if item.source === "builtin"}
                <Badge tone="muted">{t("plugins.builtin")}</Badge>
              {:else if record}
                <Badge tone="success">{t("plugins.installed")}</Badge>
              {:else}
                <Badge tone="admin">{t("plugins.community")}</Badge>
              {/if}
            </div>
          </div>

          <p class="mt-2 text-[11.5px] leading-relaxed text-text-secondary">{item.description}</p>

          {#if record}<ContributionBadges contributions={record.contributions} />{/if}
        </div>

        <div class="mt-3.5 flex items-center justify-between border-t border-border/60 pt-2.5">
          {#if record}
            <div class="flex items-center gap-2">
              <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted">
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                  checked={record.enabled}
                  onchange={(e) => pluginRegistry.setEnabled(record.manifest.id, e.currentTarget.checked)}
                />
                <span>{record.enabled ? t("plugins.enabled") : t("plugins.disabled")}</span>
              </label>

              {#if hasSettings && record.manifest.settings}
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
            </div>
          {:else}
            <Button
              variant="primary"
              size="sm"
              onclick={() => template && onInstallTemplate(template.sourceCode)}
              disabled={studioBusy}
            >
              <Icon icon={PlusIcon} size={12} />
              {t("plugins.installOneClick")}
            </Button>
          {/if}

          {#if template}
            <Button variant="ghost" size="sm" onclick={() => onInspectCode(template.sourceCode)}>
              <Icon icon={CodeIcon} size={12} />
              {t("plugins.viewCode")}
            </Button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if items.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center text-text-muted"
    >
      <Icon icon={SearchIcon} size={24} class="mb-2 text-text-muted/60" />
      <span class="text-xs font-semibold text-text">{t("plugins.noResults")}</span>
    </div>
  {/if}
</div>
