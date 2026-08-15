import { useRef } from "react";
import { UploadIcon, DownloadIcon, CheckCircleIcon, PlusIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
import { PLUGIN_BOILERPLATES } from "@/features/plugins/communityTemplates";
import type { PluginManifest, Contribution } from "@/features/plugins/types";
import { useTranslation } from "@/i18n/useTranslation";
import { triggerDownload } from "@/utils/download";

export function StudioTab({
  code,
  busy,
  error,
  validationSuccess,
  onChangeCode,
  onTestCode,
  onSavePlugin,
}: {
  code: string;
  busy: boolean;
  error: string | null;
  validationSuccess: { manifest: PluginManifest; contributions: Contribution[] } | null;
  onChangeCode: (newCode: string) => void;
  onTestCode: () => void;
  onSavePlugin: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text">{t("plugins.starterTemplate")}</span>
          <select
            className={`${SELECT_CLASS} max-w-[280px] text-xs`}
            onChange={(e) => {
              const found = PLUGIN_BOILERPLATES.find((b) => b.id === e.target.value);
              if (found) onChangeCode(found.code);
            }}
          >
            {PLUGIN_BOILERPLATES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".js,.txt"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onChangeCode(await file.text());
            }}
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon size={13} /> {t("plugins.chooseFile")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const blob = new Blob([code], { type: "text/javascript" });
              triggerDownload(URL.createObjectURL(blob), "my-plugin.js", true);
            }}
          >
            <DownloadIcon size={13} /> {t("plugins.exportJs")}
          </Button>
        </div>
      </div>

      <textarea
        className={`${TEXTAREA_CODE_CLASS} h-72 w-full font-mono text-xs leading-relaxed`}
        value={code}
        onChange={(e) => onChangeCode(e.target.value)}
        placeholder="athanor.plugin({ id: 'me.custom', name: 'Mon Plugin' });\n..."
      />

      {/* Validation & Actions Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-raised p-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onTestCode} disabled={busy || !code.trim()}>
            <CheckCircleIcon size={13} /> {t("plugins.testAndValidate")}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={onSavePlugin} disabled={busy || !code.trim()}>
            <PlusIcon size={13} /> {t("plugins.saveAndInstall")}
          </Button>
        </div>
      </div>

      {validationSuccess && (
        <div className="rounded-xl border border-success/30 bg-success-light/30 p-3 text-xs text-text">
          <div className="flex items-center gap-2 font-bold text-success">
            <CheckCircleIcon size={14} /> {t("plugins.validationSuccess")}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-text-secondary">
            <span>
              {t("plugins.idLabel")} <strong>{validationSuccess.manifest.id}</strong>
            </span>
            <span>
              {t("plugins.nameLabel")} <strong>{validationSuccess.manifest.name}</strong>
            </span>
            <span>
              {t("plugins.contributionsLabel")} <strong>{validationSuccess.contributions.length}</strong>
            </span>
          </div>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
