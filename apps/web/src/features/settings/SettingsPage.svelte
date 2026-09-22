<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon, LogOutIcon } from "@/components/icons/Icons";
  import ChangePasswordModal from "@/features/auth/ChangePasswordModal.svelte";
  import { SETTINGS_SECTIONS } from "@/features/settings/settingsSections";
  import { useSettingsPanelState } from "@/features/settings/settingsPanelState.svelte";
  import SettingsTabContent from "@/features/settings/SettingsTabContent.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { Session } from "@/types";
  import { APP_HEADER } from "@/components/ui/layout";

  let {
    session,
    onBack,
    onDisplayNameChange,
    onLogout,
  }: {
    session: Session;
    onBack: () => void;
    onDisplayNameChange: (name: string) => Promise<void>;
    onLogout?: () => void;
  } = $props();

  const { t } = useTranslation();
  const state = useSettingsPanelState(() => session, (name) => onDisplayNameChange(name));
</script>

<div class="min-h-screen bg-bg text-text flex flex-col font-sans select-none">
  <header class={`${APP_HEADER} justify-between`}>
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" onclick={onBack} class="text-xs">
        <Icon icon={ChevronLeftIcon} size={16} />
        {t("common.back")}
      </Button>
      <span class="w-px h-4 bg-border/60"></span>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="flex items-center gap-2 cursor-pointer" onclick={onBack}>
        <BrandMark size={24} />
        <span class="font-extrabold text-sm tracking-tight text-text">{t("navbar.accountSettings")}</span>
      </div>
    </div>

    <div class="flex items-center gap-3">
      {#if onLogout}
        <Button variant="danger-ghost" size="sm" onclick={onLogout}>
          <Icon icon={LogOutIcon} size={14} />
          {t("common.logout")}
        </Button>
      {/if}
    </div>
  </header>

  <div class="flex-1 flex max-w-6xl w-full mx-auto px-6 py-8 gap-8">
    <aside class="w-64 shrink-0 space-y-1">
      <div class="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {t("settings.navHeading")}
      </div>
      {#each SETTINGS_SECTIONS as section (section.id)}
        <button
          onclick={() => state.setActiveTab(section.id)}
          class={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all text-left ${
            state.activeTab === section.id
              ? "bg-primary text-white shadow-sm font-bold"
              : "text-text-secondary hover:bg-surface-hover hover:text-text"
          }`}
        >
          <Icon icon={section.icon} size={16} />
          <span>{t(section.labelKey)}</span>
        </button>
      {/each}
    </aside>

    <main class="flex-1 max-w-2xl bg-surface/40 p-6 rounded-xl border border-border/60 space-y-6">
      <SettingsTabContent tab={state.activeTab} {session} {state} />
    </main>
  </div>

  {#if state.showChangePassword}
    <ChangePasswordModal onClose={() => state.setShowChangePassword(false)} />
  {/if}
</div>
