import { useEffect, useState } from "react";
import { getPerfReport, isPerfEnabled, resetPerfReport, setPerfEnabled, type PerfReportRow } from "@/utils/perfMonitor";
import { useTranslation } from "@/i18n/useTranslation";

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
export function PerfHud() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PerfReportRow[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (!isPerfEnabled()) setPerfEnabled(true);
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const tick = () => setRows(getPerfReport());
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        width: 480,
        maxHeight: "50vh",
        overflow: "auto",
        background: "rgba(20, 20, 24, 0.95)",
        color: "#e6e6e6",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        borderRadius: 8,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        padding: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>{t("perfHud.title", { count: rows.length })}</strong>
        <span style={{ opacity: 0.6 }}>{t("perfHud.closeHint")}</span>
        <button
          onClick={resetPerfReport}
          style={{
            marginLeft: "auto",
            background: "transparent",
            color: "#e6e6e6",
            border: "1px solid #555",
            borderRadius: 4,
            padding: "1px 6px",
            cursor: "pointer",
          }}
        >
          {t("perfHud.reset")}
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.7 }}>
            <th>{t("perfHud.columnLabel")}</th>
            <th>n</th>
            <th>avg</th>
            <th>p95</th>
            <th>max</th>
            <th>{t("perfHud.columnLast")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} style={{ color: row.p95Ms > 16 ? "#ff8080" : "#e6e6e6" }}>
              <td>{row.label}</td>
              <td>{row.count}</td>
              <td>{row.avgMs}</td>
              <td>{row.p95Ms}</td>
              <td>{row.maxMs}</td>
              <td>{row.lastMs}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ opacity: 0.6, padding: "4px 0" }}>
                {t("perfHud.empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
