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
    embedded = false,
  }: {
    session: Session;
    onBack: () => void;
    onDisplayNameChange: (name: string) => Promise<void>;
    onLogout?: () => void;
    embedded?: boolean;
  } = $props();

  const { t } = useTranslation();
  const state = useSettingsPanelState(
    () => session,
    (name) => onDisplayNameChange(name),
  );
</script>

<div class={`${embedded ? "min-h-0 flex-1 overflow-auto" : "min-h-screen"} bg-bg text-text flex flex-col font-sans`}>
  {#if !embedded}
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
  {/if}

  <div class="flex-1 flex flex-col md:flex-row max-w-6xl w-full mx-auto px-4 md:px-6 py-6 gap-6">
    <aside class="w-full md:w-48 shrink-0 space-y-1">
      <div class="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {t("settings.navHeading")}
      </div>
      {#each SETTINGS_SECTIONS as section (section.id)}
        <button
          onclick={() => state.setActiveTab(section.id)}
          aria-current={state.activeTab === section.id ? "page" : undefined}
          class={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left ${
            state.activeTab === section.id
              ? "bg-primary-light text-primary"
              : "text-text-secondary hover:bg-surface-hover hover:text-text"
          }`}
        >
          <Icon icon={section.icon} size={16} />
          <span>{t(section.labelKey)}</span>
        </button>
      {/each}
    </aside>

    <div class="min-w-0 flex-1 max-w-2xl bg-surface-raised p-4 md:p-6 rounded-lg border border-border space-y-6">
      <SettingsTabContent tab={state.activeTab} {session} {state} />
    </div>
  </div>

  {#if state.showChangePassword}
    <ChangePasswordModal onClose={() => state.setShowChangePassword(false)} />
  {/if}
</div>
