import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { ChevronLeftIcon, LogOutIcon } from "@/components/icons/Icons";
import { ChangePasswordModal } from "@/features/auth/ChangePasswordModal";
import { SETTINGS_SECTIONS } from "@/features/settings/settingsSections";
import { useSettingsPanelState } from "@/features/settings/useSettingsPanelState";
import { SettingsTabContent } from "@/features/settings/SettingsTabContent";
import { useTranslation } from "@/i18n/useTranslation";
import type { Session } from "@/types";
import { APP_HEADER } from "@/components/ui/layout";

export interface SettingsPageProps {
  session: Session;
  onBack: () => void;
  onDisplayNameChange: (name: string) => Promise<void>;
  onLogout?: () => void;
}

export function SettingsPage({ session, onBack, onDisplayNameChange, onLogout }: SettingsPageProps) {
  const { t } = useTranslation();
  const state = useSettingsPanelState(session, onDisplayNameChange);

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col font-sans select-none">
      <header className={`${APP_HEADER} justify-between`}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
            <ChevronLeftIcon size={16} /> {t("common.back")}
          </Button>
          <span className="w-px h-4 bg-border/60" />
          <div className="flex items-center gap-2 cursor-pointer" onClick={onBack}>
            <BrandMark size={24} />
            <span className="font-extrabold text-sm tracking-tight text-text">{t("navbar.accountSettings")}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onLogout && (
            <Button variant="danger-ghost" size="sm" onClick={onLogout}>
              <LogOutIcon size={14} /> {t("common.logout")}
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex max-w-6xl w-full mx-auto px-6 py-8 gap-8">
        <aside className="w-64 shrink-0 space-y-1">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
            {t("settings.navHeading")}
          </div>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => state.setActiveTab(section.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all text-left ${
                state.activeTab === section.id
                  ? "bg-primary text-white shadow-sm font-bold"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text"
              }`}
            >
              {section.icon}
              <span>{t(section.labelKey)}</span>
            </button>
          ))}
        </aside>

        <main className="flex-1 max-w-2xl bg-surface/40 p-6 rounded-xl border border-border/60 space-y-6">
          <SettingsTabContent tab={state.activeTab} session={session} state={state} />
        </main>
      </div>

      {state.showChangePassword && <ChangePasswordModal onClose={() => state.setShowChangePassword(false)} />}
    </div>
  );
}
