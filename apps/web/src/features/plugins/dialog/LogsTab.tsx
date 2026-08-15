import { LayersIcon } from "@/components/icons/Icons";
import { useTranslation } from "@/i18n/useTranslation";

export function LogsTab({ logs }: { logs: Array<{ pluginName: string; line: string }> }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text">
          {t("plugins.executionLogCount", { count: logs.length })}
        </span>
      </div>

      {logs.length > 0 ? (
        <div className="max-h-80 overflow-auto rounded-xl border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
          {logs.map((log, idx) => (
            <div key={idx} className="flex items-start gap-2 py-0.5 border-b border-border/30 last:border-0">
              <span className="text-primary font-bold">[{log.pluginName}]</span>
              <span className="text-text">{log.line}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center text-text-muted">
          <LayersIcon size={20} className="mb-2 text-text-muted/60" />
          <span className="text-xs font-semibold text-text">{t("plugins.noLogs")}</span>
        </div>
      )}
    </div>
  );
}
