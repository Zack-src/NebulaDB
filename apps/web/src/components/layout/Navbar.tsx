import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { SettingsIcon, UsersIcon, LogOutIcon } from "@/components/icons/Icons";
import { useTranslation } from "@/i18n/useTranslation";
import type { Session } from "@/types";

export const APP_NAME = "AthanorDB";

export interface NavbarProps {
  session: Session;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  onLogout?: () => void;
  title?: string;
  onBack?: () => void;
}

export function Navbar({ session, onOpenSettings, onOpenAdmin, onLogout, title = APP_NAME, onBack }: NavbarProps) {
  const { t } = useTranslation();

  return (
    <header className="h-14 shrink-0 px-6 border-b border-border/80 bg-surface/90 glass-panel flex items-center justify-between z-30 select-none">
      <div className="flex items-center gap-4">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
            ← {t("common.back")}
          </Button>
        ) : (
          <div className="flex items-center gap-2.5 select-none">
            <BrandMark size={24} />
            <span className="font-extrabold text-sm tracking-tight text-text">{title}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {session.isAdmin && onOpenAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenAdmin}
            data-tooltip={t("admin.title")}
            data-tooltip-pos="bottom"
            className="gap-1.5 text-xs"
          >
            <UsersIcon size={13} /> {t("common.admin")}
          </Button>
        )}

        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-raised border border-border/60 text-xs font-semibold hover:bg-surface-hover transition-colors"
          data-tooltip={t("navbar.accountSettings")}
          data-tooltip-pos="bottom"
        >
          <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-[10px]">
            {session.displayName.charAt(0).toUpperCase()}
          </div>
          <SettingsIcon size={13} className="text-text-muted" />
        </button>

        {onOpenSettings && (
          <Button variant="ghost" size="sm" onClick={onOpenSettings} className="hidden md:inline-flex gap-1.5 text-xs">
            <SettingsIcon size={13} /> {t("common.settings")}
          </Button>
        )}

        {onLogout && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            data-tooltip={t("common.logout")}
            data-tooltip-pos="bottom"
          >
            <LogOutIcon size={14} />
          </Button>
        )}
      </div>
    </header>
  );
}
