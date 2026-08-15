import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorText } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { CHECKBOX_CLASS } from "@/components/ui/inputStyles";
import { KeyIcon, CheckIcon, SparklesIcon } from "@/components/icons/Icons";
import { SUPPORTED_LOCALES } from "@/i18n/translate";
import { useTranslation } from "@/i18n/useTranslation";
import type { Session, TranslationKeyOf } from "@/types";
import { ActiveSessions } from "@/features/settings/ActiveSessions";
import { PersonalData } from "@/features/settings/PersonalData";
import type { useSettingsPanelState, SettingsTab } from "@/features/settings/useSettingsPanelState";

const THEME_PRESETS = [
  {
    id: "obsidian",
    nameKey: "settings.appearance.theme.obsidian",
    swatch: "bg-[#090a0f] border-primary",
    available: true,
  },
  {
    id: "midnight",
    nameKey: "settings.appearance.theme.midnight",
    swatch: "bg-[#0f172a] border-blue-500",
    available: false,
  },
  {
    id: "emerald",
    nameKey: "settings.appearance.theme.emerald",
    swatch: "bg-[#064e3b] border-emerald-500",
    available: false,
  },
  {
    id: "light",
    nameKey: "settings.appearance.theme.light",
    swatch: "bg-[#f8fafc] border-slate-400",
    available: false,
  },
] as const satisfies readonly { id: string; nameKey: TranslationKeyOf; swatch: string; available: boolean }[];

const LOCALE_LABEL_KEY = { fr: "language.fr", en: "language.en" } as const satisfies Record<string, TranslationKeyOf>;

/**
 * A labelled on/off row. Built as a real `<label>` wrapping the checkbox so the
 * text names the control for assistive tech and clicking anywhere in the row
 * toggles it — the hand-rolled rows this replaces were bare `<input>`s beside
 * unassociated `<div>`s, with no accessible name at all.
 */
function SettingSwitch(props: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised p-3.5 transition-colors hover:border-border-strong">
      <span className="min-w-0">
        <span className="block text-xs font-bold text-text">{props.label}</span>
        <span className="block text-[11px] leading-normal text-text-muted">{props.hint}</span>
      </span>
      <input
        type="checkbox"
        className={`${CHECKBOX_CLASS} h-4 w-4`}
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

const PRODUCT_VERSION = "v0.0.1-open-core";
/** Licence identifier, not prose — never translated. */
const PRODUCT_LICENSE = "MIT Open Source";

export interface SettingsTabContentProps {
  tab: SettingsTab;
  session: Session;
  state: ReturnType<typeof useSettingsPanelState>;
}

/**
 * The six settings tab bodies, shared by `SettingsPage` (full page) and
 * `SettingsModal` (in-editor overlay) — same content, two different shells.
 * Only the `tab` prop changes what's rendered; the surrounding chrome
 * (sidebar nav, header) stays with each caller since it differs on purpose.
 */
export function SettingsTabContent({ tab, session, state }: SettingsTabContentProps) {
  const { t, locale, setLocale } = useTranslation();

  if (tab === "profile") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">{t("settings.profile.title")}</h2>
          <p className="text-xs text-text-muted">{t("settings.profile.subtitle")}</p>
        </div>

        <form onSubmit={state.handleSaveDisplayName} className="space-y-4 max-w-md">
          <Field label={t("settings.profile.emailLabel")} type="email" value={session.email} disabled readOnly />
          <Field
            label={t("settings.profile.displayNameLabel")}
            type="text"
            value={state.displayName}
            onChange={(event) => state.setDisplayName(event.target.value)}
          />
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              type="submit"
              disabled={state.savingName || !state.displayName.trim() || state.displayName === session.displayName}
            >
              {state.savingName ? t("common.saving") : t("settings.profile.save")}
            </Button>
            {state.nameSavedSuccess && (
              <span className="flex items-center gap-1 text-xs font-semibold text-success">
                <CheckIcon size={14} /> {t("common.updated")}
              </span>
            )}
          </div>
          {state.nameSaveError && <ErrorText>{state.nameSaveError}</ErrorText>}
        </form>

        <div className="pt-6 border-t border-border/60">
          <h3 className="text-sm font-bold text-text mb-1">{t("settings.profile.securityTitle")}</h3>
          <p className="text-xs text-text-muted mb-4">{t("settings.profile.securitySubtitle")}</p>
          <Button variant="outline" onClick={() => state.setShowChangePassword(true)} className="gap-2 text-xs">
            <KeyIcon size={14} /> {t("changePassword.title")}
          </Button>
        </div>

        <ActiveSessions />
        <PersonalData />
      </div>
    );
  }

  if (tab === "appearance") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">{t("settings.appearance.title")}</h2>
          <p className="text-xs text-text-muted">{t("settings.appearance.subtitle")}</p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-text">{t("language.label")}</label>
          <Tabs
            variant="boxed"
            tabs={SUPPORTED_LOCALES.map((supported) => ({
              id: supported,
              label: t(LOCALE_LABEL_KEY[supported]),
            }))}
            activeTab={locale}
            onChange={(next) => setLocale(next as typeof locale)}
          />
        </div>

        <div className="space-y-3 pt-6 border-t border-border/60">
          <label className="text-xs font-semibold text-text">{t("settings.appearance.colorPreset")}</label>
          <div className="grid grid-cols-2 gap-3">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={!preset.available}
                onClick={() => state.setThemePreset(preset.id)}
                data-tooltip={preset.available ? undefined : t("settings.appearance.comingSoon")}
                className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                  !preset.available
                    ? "opacity-40 cursor-not-allowed border-border/40"
                    : state.themePreset === preset.id
                      ? "border-primary ring-1 ring-primary/40 font-bold text-text bg-surface-raised"
                      : "border-border/60 hover:border-border"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {t(preset.nameKey)}
                  {!preset.available && <Badge tone="muted">{t("settings.appearance.soon")}</Badge>}
                </span>
                <span className={`w-4 h-4 rounded-full border ${preset.swatch}`} />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 pt-6 border-t border-border/60">
          <label className="text-xs font-semibold text-text">{t("settings.appearance.gridStyle")}</label>
          <Tabs
            variant="boxed"
            tabs={[
              { id: "dots", label: t("settings.appearance.grid.dots") },
              { id: "lines", label: t("settings.appearance.grid.lines") },
              { id: "cross", label: t("settings.appearance.grid.cross") },
            ]}
            activeTab={state.gridStyle}
            onChange={state.setGridStyle}
          />
        </div>
      </div>
    );
  }

  if (tab === "editor") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">{t("settings.editor.title")}</h2>
          <p className="text-xs text-text-muted">{t("settings.editor.subtitle")}</p>
        </div>

        {/* The auto-layout "algorithm" choice that used to sit here offered
            dagre and force; only dagre exists (`canvas/autoLayout.ts` has no
            algorithm parameter at all), so the control could only ever mislead. */}
        <div className="space-y-3">
          <SettingSwitch
            label={t("settings.editor.gridSnapping")}
            hint={t("settings.editor.gridSnappingHint")}
            checked={state.snapToGrid}
            onChange={state.setSnapToGrid}
          />
          <SettingSwitch
            label={t("settings.editor.foreignKeyHighlight")}
            hint={t("settings.editor.foreignKeyHighlightHint")}
            checked={state.highlightLinks}
            onChange={state.setHighlightLinks}
          />
        </div>
      </div>
    );
  }

  if (tab === "team") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">{t("settings.team.title")}</h2>
          <p className="text-xs text-text-muted">{t("settings.team.subtitle")}</p>
        </div>

        <Card variant="glass" className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
                {session.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-xs text-text">{session.displayName}</div>
                <div className="text-[11px] text-text-muted">{session.email}</div>
              </div>
            </div>
            <Badge tone={session.isAdmin ? "admin" : "success"}>
              {session.isAdmin ? t("permission.administrator") : t("settings.team.owner")}
            </Badge>
          </div>
        </Card>
      </div>
    );
  }

  if (tab === "billing") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">{t("settings.billing.title")}</h2>
          <p className="text-xs text-text-muted">{t("settings.billing.subtitle")}</p>
        </div>

        <Card variant="glow" className="p-5 border-primary">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <SparklesIcon size={18} className="text-primary" />
              <span className="font-bold text-xs text-text">{t("settings.billing.plan")}</span>
            </div>
            <Badge tone="success">{t("settings.billing.freeForever")}</Badge>
          </div>

          <p className="text-xs text-text-secondary leading-relaxed">{t("settings.billing.description")}</p>
        </Card>

        <div className="space-y-2 pt-4 border-t border-border/60">
          <h3 className="text-xs font-bold text-text">{t("settings.billing.apiKeysTitle")}</h3>
          <p className="text-xs text-text-muted leading-relaxed">{t("settings.billing.apiKeysDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-text mb-1">{t("settings.about.title")}</h2>
        <p className="text-xs text-text-muted">{t("settings.about.subtitle")}</p>
      </div>

      <div className="space-y-3 font-mono text-xs bg-surface p-4 rounded-xl border border-border/80">
        <div className="flex justify-between">
          <span className="text-text-muted">{t("settings.about.version")}</span>
          <span className="text-text font-bold">{PRODUCT_VERSION}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">{t("settings.about.license")}</span>
          <span className="text-success font-bold">{PRODUCT_LICENSE}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">{t("settings.about.syncStatus")}</span>
          <span className="text-success font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse-subtle" /> {t("settings.about.operational")}
          </span>
        </div>
      </div>
    </div>
  );
}
