<script lang="ts">
  import { autofocus } from "@/actions/autofocus";
  import Icon from "@/components/icons/Icon.svelte";
  import { CodeIcon, SearchIcon, SettingsIcon, SparklesIcon } from "@/components/icons/Icons";
  import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
  import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let {
    commands,
    onRun,
    onOpenPlugins,
    onClose,
  }: {
    commands: ResolvedContribution<CanvasCommandContribution>[];
    onRun: (command: ResolvedContribution<CanvasCommandContribution>) => void;
    onOpenPlugins: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let query = $state("");
  let selectedIndex = $state(0);

  const filteredCommands = $derived.by(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.contribution.label.toLowerCase().includes(q) ||
        (c.contribution.description && c.contribution.description.toLowerCase().includes(q)) ||
        c.plugin.name.toLowerCase().includes(q),
    );
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % Math.max(1, filteredCommands.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const command = filteredCommands[selectedIndex];
      if (command) {
        onRun(command);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex flex-col w-[300px] overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl animate-popover-in"
  onkeydown={handleKeyDown}
>
  <!-- Search Bar -->
  <div class="flex items-center gap-2 border-b border-border bg-surface-raised/80 px-3 py-2">
    <Icon icon={SearchIcon} size={14} class="text-text-muted shrink-0" />
    <input
      use:autofocus
      type="text"
      value={query}
      oninput={(e) => {
        query = e.currentTarget.value;
        selectedIndex = 0;
      }}
      placeholder={t("plugins.quickPalettePlaceholder")}
      class="w-full bg-transparent text-xs text-text placeholder:text-text-muted focus:outline-hidden"
    />
  </div>

  <!-- Commands List -->
  <div class="max-h-64 overflow-y-auto p-1.5 flex flex-col gap-0.5">
    {#each filteredCommands as command, idx (command.key)}
      {@const isSelected = idx === selectedIndex}
      <button
        type="button"
        class={`${CONTEXT_MENU_ITEM_CLASS} justify-between text-left ${isSelected ? "bg-surface-hover text-text font-medium" : ""}`}
        onmouseenter={() => (selectedIndex = idx)}
        onclick={() => {
          onRun(command);
          onClose();
        }}
        data-tooltip={command.contribution.description}
      >
        <div class="flex items-center gap-2 min-w-0">
          {#if command.source === "builtin"}
            <Icon icon={SparklesIcon} size={13} class="text-primary shrink-0" />
          {:else}
            <Icon icon={CodeIcon} size={13} class="text-accent-cyan shrink-0" />
          {/if}
          <span class="truncate text-xs">{command.contribution.label}</span>
        </div>

        <div class="flex items-center gap-1.5 shrink-0 ml-2">
          {#if command.contribution.shortcut}
            <span class="rounded bg-surface-raised px-1 py-0.5 text-[9.5px] font-mono text-text-muted">
              {command.contribution.shortcut}
            </span>
          {/if}
        </div>
      </button>
    {/each}

    {#if filteredCommands.length === 0}
      <div class="py-6 text-center text-xs text-text-muted">{t("plugins.noMatchForQuery", { query })}</div>
    {/if}
  </div>

  <!-- Footer link to Manager -->
  <div class="border-t border-border bg-surface-raised/60 p-1.5">
    <button
      type="button"
      class={`${CONTEXT_MENU_ITEM_CLASS} w-full justify-between text-xs text-text-muted hover:text-text`}
      onclick={() => {
        onClose();
        onOpenPlugins();
      }}
    >
      <div class="flex items-center gap-2">
        <Icon icon={SettingsIcon} size={13} />
        <span>{t("plugins.managePlugins")}</span>
      </div>
      <span class="text-[10px] text-text-muted">{t("plugins.exploreAndCreate")}</span>
    </button>
  </div>
</div>
