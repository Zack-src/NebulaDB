import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { ChevronLeftIcon, SettingsIcon, UsersIcon, LogOutIcon } from "@/components/icons/Icons";
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

/**
 * App header. The account control is a single button — avatar, name and gear —
 * rather than the avatar chip *and* a separate "Settings" button it used to
 * carry side by side, both opening the same panel. The name is what makes it
 * worth the width: on a shared or multi-account install it is the only place
 * that says who you are signed in as.
 */
export function Navbar({ session, onOpenSettings, onOpenAdmin, onLogout, title = APP_NAME, onBack }: NavbarProps) {
  const { t } = useTranslation();

  return (
    <header className="z-30 flex h-14 shrink-0 select-none items-center justify-between gap-4 border-b border-border bg-surface/90 px-4 glass-panel sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeftIcon size={14} /> {t("common.back")}
          </Button>
        ) : (
          <div className="flex select-none items-center gap-2.5">
            <BrandMark size={24} />
            <span className="truncate text-sm font-extrabold tracking-tight text-text">{title}</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {session.isAdmin && onOpenAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAdmin}
            data-tooltip={t("admin.title")}
            data-tooltip-pos="bottom"
          >
            <UsersIcon size={14} /> <span className="hidden sm:inline">{t("common.admin")}</span>
          </Button>
        )}

        {onOpenSettings && (
          <Button
            variant="default"
            size="sm"
            onClick={onOpenSettings}
            data-tooltip={t("navbar.accountSettings")}
            data-tooltip-pos="bottom"
            className="max-w-[220px] gap-2 pl-1.5"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-light text-[10px] font-bold text-primary">
              {session.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="hidden truncate text-text sm:inline">{session.displayName}</span>
            <SettingsIcon size={13} className="shrink-0 text-text-muted" />
          </Button>
        )}

        {onLogout && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onLogout}
            data-tooltip={t("common.logout")}
            data-tooltip-pos="bottom"
            aria-label={t("common.logout")}
          >
            <LogOutIcon size={14} />
          </Button>
        )}
      </div>
    </header>
  );
}
