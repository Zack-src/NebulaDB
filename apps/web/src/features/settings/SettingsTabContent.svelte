<script lang="ts" module>
  import type { TranslationKeyOf } from "@/types";

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
      available: true,
    },
  ] as const satisfies readonly { id: string; nameKey: TranslationKeyOf; swatch: string; available: boolean }[];

  const LOCALE_LABEL_KEY = { fr: "language.fr", en: "language.en" } as const satisfies Record<string, TranslationKeyOf>;

  const PRODUCT_VERSION = "v0.0.1-open-core";
  /** Licence identifier, not prose — never translated. */
  const PRODUCT_LICENSE = "MIT Open Source";
</script>

<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Card from "@/components/ui/Card.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Tabs from "@/components/ui/Tabs.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon, KeyIcon, SparklesIcon } from "@/components/icons/Icons";
  import { SUPPORTED_LOCALES, type Locale } from "@/i18n/translate";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import type { Session } from "@/types";
  import type { GridStyle } from "@/utils/preferences";
  import ActiveSessions from "@/features/settings/ActiveSessions.svelte";
  import ApiKeys from "@/features/settings/ApiKeys.svelte";
  import PersonalData from "@/features/settings/PersonalData.svelte";
  import TwoFactorAuth from "@/features/settings/TwoFactorAuth.svelte";
  import SettingSwitch from "@/features/settings/SettingSwitch.svelte";
  import type { SettingsPanelState, SettingsTab } from "@/features/settings/settingsPanelState.svelte";

  /**
   * The six settings tab bodies, shared by `SettingsPage` (full page) and
   * `SettingsModal` (in-editor overlay) — same content, two different shells.
   * Only the `tab` prop changes what's rendered; the surrounding chrome
   * (sidebar nav, header) stays with each caller since it differs on purpose.
   */
  let { tab, session, state }: { tab: SettingsTab; session: Session; state: SettingsPanelState } = $props();

  const { t, setLocale } = useTranslation();
</script>

{#if tab === "profile"}
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-bold text-text mb-1">{t("settings.profile.title")}</h2>
      <p class="text-xs text-text-muted">{t("settings.profile.subtitle")}</p>
    </div>

    <form onsubmit={state.handleSaveDisplayName} class="space-y-4 max-w-md">
      <Field label={t("settings.profile.emailLabel")} type="email" value={session.email} disabled readonly />
      <Field label={t("settings.profile.displayNameLabel")} type="text" bind:value={state.displayName} />
      <div class="flex items-center gap-3 pt-2">
        <Button
          variant="primary"
          type="submit"
          disabled={state.savingName || !state.displayName.trim() || state.displayName === session.displayName}
        >
          {state.savingName ? t("common.saving") : t("settings.profile.save")}
        </Button>
        {#if state.nameSavedSuccess}
          <span class="flex items-center gap-1 text-xs font-semibold text-success">
            <Icon icon={CheckIcon} size={14} />
            {t("common.updated")}
          </span>
        {/if}
      </div>
      {#if state.nameSaveError}<ErrorText>{state.nameSaveError}</ErrorText>{/if}
    </form>

    <div class="pt-6 border-t border-border/60">
      <h3 class="text-sm font-bold text-text mb-1">{t("settings.profile.securityTitle")}</h3>
      <p class="text-xs text-text-muted mb-4">{t("settings.profile.securitySubtitle")}</p>
      <Button variant="outline" onclick={() => state.setShowChangePassword(true)} class="gap-2 text-xs">
        <Icon icon={KeyIcon} size={14} />
        {t("changePassword.title")}
      </Button>
    </div>

    <TwoFactorAuth />
    <ActiveSessions />
    <PersonalData />
  </div>
{:else if tab === "appearance"}
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-bold text-text mb-1">{t("settings.appearance.title")}</h2>
      <p class="text-xs text-text-muted">{t("settings.appearance.subtitle")}</p>
    </div>

    <div class="space-y-3">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-xs font-semibold text-text">{t("language.label")}</label>
      <Tabs
        variant="boxed"
        tabs={SUPPORTED_LOCALES.map((supported) => ({ id: supported, label: t(LOCALE_LABEL_KEY[supported]) }))}
        activeTab={i18n.locale}
        onChange={(next) => setLocale(next as Locale)}
      />
    </div>

    <div class="space-y-3 pt-6 border-t border-border/60">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-xs font-semibold text-text">{t("settings.appearance.colorPreset")}</label>
      <div class="grid grid-cols-2 gap-3">
        {#each THEME_PRESETS as preset (preset.id)}
          <button
            type="button"
            disabled={!preset.available}
            onclick={() => state.setThemePreset(preset.id)}
            data-tooltip={preset.available ? undefined : t("settings.appearance.comingSoon")}
            class={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
              !preset.available
                ? "opacity-40 cursor-not-allowed border-border/40"
                : state.themePreset === preset.id
                  ? "border-primary ring-1 ring-primary/40 font-bold text-text bg-surface-raised"
                  : "border-border/60 hover:border-border"
            }`}
          >
            <span class="flex items-center gap-1.5">
              {t(preset.nameKey)}
              {#if !preset.available}<Badge tone="muted">{t("settings.appearance.soon")}</Badge>{/if}
            </span>
            <span class={`w-4 h-4 rounded-full border ${preset.swatch}`}></span>
          </button>
        {/each}
      </div>
    </div>

    <div class="space-y-3 pt-6 border-t border-border/60">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-xs font-semibold text-text">{t("settings.appearance.gridStyle")}</label>
      <Tabs
        variant="boxed"
        tabs={[
          { id: "dots", label: t("settings.appearance.grid.dots") },
          { id: "lines", label: t("settings.appearance.grid.lines") },
          { id: "cross", label: t("settings.appearance.grid.cross") },
        ]}
        activeTab={state.gridStyle}
        onChange={(next) => state.setGridStyle(next as GridStyle)}
      />
    </div>
  </div>
{:else if tab === "editor"}
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-bold text-text mb-1">{t("settings.editor.title")}</h2>
      <p class="text-xs text-text-muted">{t("settings.editor.subtitle")}</p>
    </div>

    <!-- The auto-layout "algorithm" choice that used to sit here offered
         dagre and force; only dagre exists (`canvas/autoLayout.ts` has no
         algorithm parameter at all), so the control could only ever mislead. -->
    <div class="space-y-3">
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
{:else if tab === "team"}
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-bold text-text mb-1">{t("settings.team.title")}</h2>
      <p class="text-xs text-text-muted">{t("settings.team.subtitle")}</p>
    </div>

    <Card variant="glass" class="p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
            {session.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div class="font-bold text-xs text-text">{session.displayName}</div>
            <div class="text-[11px] text-text-muted">{session.email}</div>
          </div>
        </div>
        <Badge tone={session.isAdmin ? "admin" : "success"}>
          {session.isAdmin ? t("permission.administrator") : t("settings.team.owner")}
        </Badge>
      </div>
    </Card>
  </div>
{:else if tab === "billing"}
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-bold text-text mb-1">{t("settings.billing.title")}</h2>
      <p class="text-xs text-text-muted">{t("settings.billing.subtitle")}</p>
    </div>

    <Card variant="glow" class="p-5 border-primary">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Icon icon={SparklesIcon} size={18} class="text-primary" />
          <span class="font-bold text-xs text-text">{t("settings.billing.plan")}</span>
        </div>
        <Badge tone="success">{t("settings.billing.freeForever")}</Badge>
      </div>

      <p class="text-xs text-text-secondary leading-relaxed">{t("settings.billing.description")}</p>
    </Card>

    <ApiKeys />
  </div>
{:else}
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-bold text-text mb-1">{t("settings.about.title")}</h2>
      <p class="text-xs text-text-muted">{t("settings.about.subtitle")}</p>
    </div>

    <div class="space-y-3 font-mono text-xs bg-surface p-4 rounded-xl border border-border/80">
      <div class="flex justify-between">
        <span class="text-text-muted">{t("settings.about.version")}</span>
        <span class="text-text font-bold">{PRODUCT_VERSION}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-text-muted">{t("settings.about.license")}</span>
        <span class="text-success font-bold">{PRODUCT_LICENSE}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-text-muted">{t("settings.about.syncStatus")}</span>
        <span class="text-success font-bold flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-success animate-pulse-subtle"></span>
          {t("settings.about.operational")}
        </span>
      </div>
    </div>
  </div>
{/if}
