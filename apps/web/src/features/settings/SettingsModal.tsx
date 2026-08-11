import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ChangePasswordModal } from "@/features/auth/ChangePasswordModal";
import { SETTINGS_SECTIONS } from "@/features/settings/settingsSections";
import { useSettingsPanelState } from "@/features/settings/useSettingsPanelState";
import { SettingsTabContent } from "@/features/settings/SettingsTabContent";
import { LogOutIcon } from "@/components/icons/Icons";
import { useTranslation } from "@/i18n/useTranslation";
import type { Session } from "@/types";

export interface SettingsModalProps {
  session: Session;
  onClose: () => void;
  onDisplayNameChange: (name: string) => void;
  onLogout?: () => void;
}

export function SettingsModal({ session, onClose, onDisplayNameChange, onLogout }: SettingsModalProps) {
  const { t } = useTranslation();
  const state = useSettingsPanelState(session, onDisplayNameChange);

  return (
    <>
      <Modal title={t("settings.modalTitle")} onClose={onClose} wide>
        <div className="flex flex-col md:flex-row min-h-[460px] gap-6">
          <div className="w-full md:w-56 shrink-0 flex flex-col justify-between border-b md:border-b-0 md:border-r border-border/50 pr-0 md:pr-4 pb-4 md:pb-0">
            <div className="space-y-1">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  onClick={() => state.setActiveTab(section.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left ${
                    state.activeTab === section.id
                      ? "bg-primary text-white shadow-sm glow-indigo"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  {section.icon}
                  <span>{t(section.labelKey)}</span>
                </button>
              ))}
            </div>

            {onLogout && (
              <div className="pt-4 border-t border-border/40 mt-4">
                <Button variant="danger-ghost" size="sm" onClick={onLogout} className="w-full justify-start gap-2">
                  <LogOutIcon size={14} /> {t("common.logout")}
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto max-h-[500px] pr-1 text-xs text-text-secondary">
            <SettingsTabContent tab={state.activeTab} session={session} state={state} />
          </div>
        </div>
      </Modal>

      {state.showChangePassword && <ChangePasswordModal onClose={() => state.setShowChangePassword(false)} />}
    </>
  );
}
