<script lang="ts">
  import { LayersIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let { logs }: { logs: Array<{ pluginName: string; line: string }> } = $props();
  const { t } = useTranslation();
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center justify-between">
    <span class="text-xs font-semibold text-text">{t("plugins.executionLogCount", { count: logs.length })}</span>
  </div>

  {#if logs.length > 0}
    <div
      class="max-h-80 overflow-auto rounded-xl border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-text-secondary"
    >
      {#each logs as log, idx (idx)}
        <div class="flex items-start gap-2 py-0.5 border-b border-border/30 last:border-0">
          <span class="text-primary font-bold">[{log.pluginName}]</span>
          <span class="text-text">{log.line}</span>
        </div>
      {/each}
    </div>
  {:else}
    <div
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center text-text-muted"
    >
      <Icon icon={LayersIcon} size={20} class="mb-2 text-text-muted/60" />
      <span class="text-xs font-semibold text-text">{t("plugins.noLogs")}</span>
    </div>
  {/if}
</div>
