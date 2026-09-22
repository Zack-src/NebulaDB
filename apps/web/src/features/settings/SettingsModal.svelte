<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { LogOutIcon } from "@/components/icons/Icons";
  import ChangePasswordModal from "@/features/auth/ChangePasswordModal.svelte";
  import { SETTINGS_SECTIONS } from "@/features/settings/settingsSections";
  import { useSettingsPanelState } from "@/features/settings/settingsPanelState.svelte";
  import SettingsTabContent from "@/features/settings/SettingsTabContent.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { Session } from "@/types";

  let {
    session,
    onClose,
    onDisplayNameChange,
    onLogout,
  }: {
    session: Session;
    onClose: () => void;
    onDisplayNameChange: (name: string) => Promise<void>;
    onLogout?: () => void;
  } = $props();

  const { t } = useTranslation();
  const state = useSettingsPanelState(() => session, (name) => onDisplayNameChange(name));
</script>

<Modal title={t("settings.modalTitle")} {onClose} wide>
  <div class="flex flex-col md:flex-row min-h-[460px] gap-6">
    <div
      class="w-full md:w-56 shrink-0 flex flex-col justify-between border-b md:border-b-0 md:border-r border-border/50 pr-0 md:pr-4 pb-4 md:pb-0"
    >
      <div class="space-y-1">
        {#each SETTINGS_SECTIONS as section (section.id)}
          <button
            onclick={() => state.setActiveTab(section.id)}
            class={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left ${
              state.activeTab === section.id
                ? "bg-primary text-white shadow-sm glow-indigo"
                : "text-text-secondary hover:bg-surface-hover hover:text-text"
            }`}
          >
            <Icon icon={section.icon} size={16} />
            <span>{t(section.labelKey)}</span>
          </button>
        {/each}
      </div>

      {#if onLogout}
        <div class="pt-4 border-t border-border/40 mt-4">
          <Button variant="danger-ghost" size="sm" onclick={onLogout} class="w-full justify-start gap-2">
            <Icon icon={LogOutIcon} size={14} />
            {t("common.logout")}
          </Button>
        </div>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto max-h-[500px] pr-1 text-xs text-text-secondary">
      <SettingsTabContent tab={state.activeTab} {session} {state} />
    </div>
  </div>
</Modal>

{#if state.showChangePassword}
  <ChangePasswordModal onClose={() => state.setShowChangePassword(false)} />
{/if}
