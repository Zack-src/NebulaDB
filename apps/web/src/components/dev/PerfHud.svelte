<script lang="ts">
  import { getPerfReport, isPerfEnabled, resetPerfReport, setPerfEnabled, type PerfReportRow } from "@/utils/perfMonitor";
  import { useTranslation } from "@/i18n/i18n.svelte";

  const REFRESH_MS = 1000;

  /**
   * Dev-only diagnostics panel for chasing editor stutter/freezes: a live table
   * of every `time()`-wrapped hot path plus the long-task counter, refreshed
   * once a second. Toggled with Ctrl+Shift+P (works even when perf logging was
   * off — pressing it turns logging on for the rest of the session).
   *
   * Deliberately not gated behind a feature flag or route — it renders nothing
   * until summoned, so mounting it unconditionally near the app root costs one
   * idle keydown listener.
   */
  const { t } = useTranslation();
  let open = $state(false);
  let rows = $state.raw<PerfReportRow[]>([]);

  $effect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (!isPerfEnabled()) setPerfEnabled(true);
        open = !open;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  $effect(() => {
    if (!open) return;
    const tick = () => {
      rows = getPerfReport();
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  });
</script>

{#if open}
  <div
    style="position: fixed; bottom: 12px; right: 12px; z-index: 9999; width: 480px; max-height: 50vh; overflow: auto; background: rgba(20, 20, 24, 0.95); color: #e6e6e6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.4); padding: 8px;"
  >
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
      <strong style="font-size: 12px;">{t("perfHud.title", { count: rows.length })}</strong>
      <span style="opacity: 0.6;">{t("perfHud.closeHint")}</span>
      <button
        onclick={resetPerfReport}
        style="margin-left: auto; background: transparent; color: #e6e6e6; border: 1px solid #555; border-radius: 4px; padding: 1px 6px; cursor: pointer;"
      >
        {t("perfHud.reset")}
      </button>
    </div>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; opacity: 0.7;">
          <th>{t("perfHud.columnLabel")}</th>
          <th>n</th>
          <th>avg</th>
          <th>p95</th>
          <th>max</th>
          <th>{t("perfHud.columnLast")}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.label)}
          <tr style:color={row.p95Ms > 16 ? "#ff8080" : "#e6e6e6"}>
            <td>{row.label}</td>
            <td>{row.count}</td>
            <td>{row.avgMs}</td>
            <td>{row.p95Ms}</td>
            <td>{row.maxMs}</td>
            <td>{row.lastMs}</td>
          </tr>
        {/each}
        {#if rows.length === 0}
          <tr>
            <td colspan={6} style="opacity: 0.6; padding: 4px 0;">{t("perfHud.empty")}</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
{/if}
