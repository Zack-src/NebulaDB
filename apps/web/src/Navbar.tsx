import { BrandMark } from "./ui/BrandMark.js";
import { Button } from "./ui/Button.js";
import { Badge } from "./ui/Badge.js";
import { StatusPill } from "./ui/StatusPill.js";
import { SettingsIcon, UsersIcon, LogOutIcon } from "./Icons.js";
import type { Session } from "./types.js";

export interface NavbarProps {
  session: Session;
  serverStatus: "checking" | "ok" | "down";
  onOpenLanding?: () => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  onLogout?: () => void;
  onDisplayNameChange?: (name: string) => void;
  title?: string;
  onBack?: () => void;
}


export function Navbar({
  session,
  serverStatus,
  onOpenLanding,
  onOpenSettings,
  onOpenAdmin,
  onLogout,
  title = "AthanorDB",
  onBack,
}: NavbarProps) {
  return (
    <header className="h-14 shrink-0 px-6 border-b border-border/80 bg-surface/90 glass-panel flex items-center justify-between z-30 select-none">
      <div className="flex items-center gap-4">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
            ← Retour
          </Button>
        ) : (
          <div
            className="flex items-center gap-2.5 cursor-pointer select-none"
            onClick={onOpenLanding}
            title="Aller à la Landing Page"
          >
            <BrandMark size={24} />
            <span className="font-extrabold text-sm tracking-tight text-text">{title}</span>
          </div>
        )}

        <Badge tone="admin" className="hidden sm:inline-flex">v0.0.1 Open-Core</Badge>
        <span className="hidden lg:inline-flex">
          <StatusPill status={serverStatus} />
        </span>
      </div>

      <div className="flex items-center gap-3">
        {session.isAdmin && onOpenAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenAdmin}
            data-tooltip="Console d'administration"
            data-tooltip-pos="bottom"
            className="gap-1.5 text-xs"
          >
            <UsersIcon size={13} /> Admin
          </Button>
        )}

        {/* User Profile Pill */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-raised border border-border/60 text-xs font-semibold hover:bg-surface-hover transition-colors"
          data-tooltip="Paramètres du compte"
          data-tooltip-pos="bottom"
        >
          <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-[10px]">
            {session.displayName.charAt(0).toUpperCase()}
          </div>
          <span className="text-text max-w-[120px] truncate">{session.displayName}</span>
          <SettingsIcon size={13} className="text-text-muted" />
        </button>

        {/* Was a "Cloud Pro" upsell button pointing at settings — an upsell for
            a product that doesn't exist, on a page the user is already using.
            It opens the settings panel, so it now says so. */}
        {onOpenSettings && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="hidden md:inline-flex gap-1.5 text-xs"
          >
            <SettingsIcon size={13} /> Paramètres
          </Button>
        )}

        {onLogout && (
          <Button variant="ghost" size="icon" onClick={onLogout} data-tooltip="Se déconnecter" data-tooltip-pos="bottom">
            <LogOutIcon size={14} />
          </Button>
        )}
      </div>
    </header>
  );
}

