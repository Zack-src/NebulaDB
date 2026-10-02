<script lang="ts">
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { SettingsIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import BehaviourSettings from "./BehaviourSettings.svelte";
  import type { CursorInfo, SyncIndicator } from "./types";

  /** Bottom strip of the editor: sync state, cursor position, diagnostics count, wrap toggle, font-size controls, behaviour settings. */
  let {
    cursor,
    syncIndicator,
    wrap,
    onToggleWrap,
    fontSize,
    onIncreaseFont,
    onDecreaseFont,
    onShowProblems,
  }: {
    cursor: CursorInfo;
    syncIndicator?: SyncIndicator;
    wrap: boolean;
    onToggleWrap: () => void;
    fontSize: number;
    onIncreaseFont: () => void;
    onDecreaseFont: () => void;
    onShowProblems: () => void;
  } = $props();

  const { t } = useTranslation();

  let settingsOpen = $state(false);
  let settingsButton: HTMLElement | undefined = $state();
  let settingsPopover: HTMLElement | undefined = $state();
  useDismissablePopover(
    () => settingsOpen,
    () => (settingsOpen = false),
    () => [settingsButton, settingsPopover],
  );

  const syncDot = { synced: "bg-success", pending: "bg-warning", error: "bg-danger" } as const;
</script>

<div class="relative flex shrink-0 items-center gap-3 whitespace-nowrap border-t border-border bg-surface px-2.5 py-1 text-[11px] text-text-muted">
  {#if syncIndicator}
    <span class="flex shrink-0 items-center gap-1.5" role="status" data-sync-state={syncIndicator.state} title={t("dbml.sync.hint")}>
      <span class={`h-1.5 w-1.5 rounded-full ${syncDot[syncIndicator.state]}`}></span>
      {#if syncIndicator.state === "error"}
        <span class="text-danger">
          {syncIndicator.line ? t("dbml.sync.errorAtLine", { line: syncIndicator.line }) : t("dbml.sync.error")}
        </span>
      {:else}
        {t(syncIndicator.state === "synced" ? "dbml.sync.synced" : "dbml.sync.pending")}
      {/if}
    </span>
  {/if}
  <!-- The cursor details give way first: on a narrow panel they are clipped, the sync state and the controls never are. -->
  <div class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
    <span title={t("dbml.lineColumn")}>Ln {cursor.line}, Col {cursor.column}</span>
    {#if cursor.selected > 0}<span>{t("dbml.selectedChars", { count: cursor.selected })}</span>{/if}
    {#if cursor.cursors > 1}<span class="text-primary">{t("dbml.cursorCount", { count: cursor.cursors })}</span>{/if}
    {#if cursor.breadcrumb}
      <span class="truncate" title={t("dbml.currentTable")}>› {cursor.breadcrumb}</span>
    {/if}
  </div>
  <span class="flex shrink-0 items-center gap-2">
    {#if cursor.errors > 0 || cursor.warnings > 0}
      <button type="button" onclick={onShowProblems} class="rounded px-1 hover:bg-surface-hover" title={t("dbml.showProblems")}>
        <span class={cursor.errors ? "text-danger" : ""}>✕ {cursor.errors}</span>
        <span class={cursor.warnings ? "text-warning" : ""}>⚠ {cursor.warnings}</span>
      </button>
    {/if}
    <button type="button" onclick={onToggleWrap} class="rounded px-1 hover:bg-surface-hover" title={t("dbml.toggleWrap")}>
      {t(wrap ? "dbml.wrapOn" : "dbml.wrapOff")}
    </button>
    <button type="button" onclick={onDecreaseFont} class="rounded px-1 hover:bg-surface-hover" title={t("dbml.fontDecrease")}>
      A−
    </button>
    <span>{fontSize}px</span>
    <button type="button" onclick={onIncreaseFont} class="rounded px-1 hover:bg-surface-hover" title={t("dbml.fontIncrease")}>
      A+
    </button>
    <button
      bind:this={settingsButton}
      type="button"
      onclick={() => (settingsOpen = !settingsOpen)}
      class="rounded px-1 hover:bg-surface-hover"
      aria-expanded={settingsOpen}
      aria-label={t("dbml.settings.title")}
      title={t("dbml.settings.title")}
    >
      <Icon icon={SettingsIcon} size={12} />
    </button>
  </span>
  {#if settingsOpen}
    <div
      bind:this={settingsPopover}
      class="absolute bottom-full right-1 z-30 mb-1 whitespace-normal rounded-md border border-border bg-surface-raised p-3 shadow-lg"
    >
      <BehaviourSettings />
    </div>
  {/if}
</div>
