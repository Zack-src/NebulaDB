<script lang="ts">
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { CursorInfo } from "./types";

  /** Bottom strip of the editor: cursor position, diagnostics count, wrap toggle, font-size controls. */
  let {
    cursor,
    wrap,
    onToggleWrap,
    fontSize,
    onIncreaseFont,
    onDecreaseFont,
    onShowProblems,
  }: {
    cursor: CursorInfo;
    wrap: boolean;
    onToggleWrap: () => void;
    fontSize: number;
    onIncreaseFont: () => void;
    onDecreaseFont: () => void;
    onShowProblems: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<div class="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-2.5 py-1 text-[11px] text-text-muted">
  <span title={t("dbml.lineColumn")}>Ln {cursor.line}, Col {cursor.column}</span>
  {#if cursor.selected > 0}<span>{t("dbml.selectedChars", { count: cursor.selected })}</span>{/if}
  {#if cursor.cursors > 1}<span class="text-primary">{t("dbml.cursorCount", { count: cursor.cursors })}</span>{/if}
  {#if cursor.breadcrumb}
    <span class="truncate" title={t("dbml.currentTable")}>› {cursor.breadcrumb}</span>
  {/if}
  <span class="ml-auto flex items-center gap-2">
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
    <span title={t("dbml.indentation")}>{t("dbml.twoSpaces")}</span>
  </span>
</div>
