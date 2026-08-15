import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
import { pluginRegistry } from "@/features/plugins/registry";
import type { PluginSettingDef, PluginSettingValue, PluginSettings } from "@/features/plugins/types";
import { useTranslation } from "@/i18n/useTranslation";

export function PluginSettingsModal({
  pluginId,
  pluginName,
  settings,
  onClose,
}: {
  pluginId: string;
  pluginName: string;
  settings: PluginSettingDef[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [currentValues, setCurrentValues] = useState<PluginSettings>(() => pluginRegistry.getSettings(pluginId));

  const handleChange = (key: string, val: PluginSettingValue) => {
    setCurrentValues((prev: PluginSettings) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    pluginRegistry.setSettings(pluginId, currentValues);
    onClose();
  };

  return (
    <Modal title={`${t("common.settings")} : ${pluginName}`} onClose={onClose}>
      <div className="flex flex-col gap-4 py-2">
        {settings.map((s) => {
          const val = currentValues[s.key] ?? s.default;

          return (
            <div key={s.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-text">{s.label}</label>
                {s.description && <span className="text-[11px] text-text-muted">{s.description}</span>}
              </div>

              {s.type === "boolean" && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded accent-primary cursor-pointer"
                    checked={Boolean(val)}
                    onChange={(e) => handleChange(s.key, e.target.checked)}
                  />
                  <span>{val ? t("plugins.enabled") : t("plugins.disabled")}</span>
                </label>
              )}

              {s.type === "string" && (
                <input
                  type="text"
                  className={INPUT_CLASS}
                  value={String(val ?? "")}
                  onChange={(e) => handleChange(s.key, e.target.value)}
                />
              )}

              {s.type === "number" && (
                <input
                  type="number"
                  className={INPUT_CLASS}
                  value={Number(val ?? 0)}
                  onChange={(e) => handleChange(s.key, Number(e.target.value))}
                />
              )}

              {s.type === "select" && s.options && (
                <select
                  className={SELECT_CLASS}
                  value={String(val ?? "")}
                  onChange={(e) => handleChange(s.key, e.target.value)}
                >
                  {s.options.map((opt: string) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleSave}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
