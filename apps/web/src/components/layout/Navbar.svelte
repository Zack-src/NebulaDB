<script lang="ts" module>
  export const APP_NAME = "AthanorDB";
</script>

<script lang="ts">
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import Button from "@/components/ui/Button.svelte";
  import { APP_HEADER } from "@/components/ui/layout";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon, LogOutIcon, SettingsIcon, UsersIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { Session } from "@/types";

  /**
   * App header. The account control is a single button — avatar, name and gear —
   * rather than the avatar chip *and* a separate "Settings" button it used to
   * carry side by side, both opening the same panel. The name is what makes it
   * worth the width: on a shared or multi-account install it is the only place
   * that says who you are signed in as.
   */
  let {
    session,
    onOpenSettings,
    onOpenAdmin,
    onLogout,
    title = APP_NAME,
    onBack,
  }: {
    session: Session;
    onOpenSettings?: () => void;
    onOpenAdmin?: () => void;
    onLogout?: () => void;
    title?: string;
    onBack?: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<header class={`${APP_HEADER} justify-between gap-4`}>
  <div class="flex min-w-0 items-center gap-3">
    {#if onBack}
      <Button variant="ghost" size="sm" onclick={onBack}>
        <Icon icon={ChevronLeftIcon} size={14} />
        {t("common.back")}
      </Button>
    {:else}
      <div class="flex select-none items-center gap-2.5">
        <BrandMark size={24} />
        <span class="truncate text-sm font-extrabold tracking-tight text-text">{title}</span>
      </div>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-1.5">
    {#if session.isAdmin && onOpenAdmin}
      <Button
        variant="ghost"
        size="sm"
        onclick={onOpenAdmin}
        data-tooltip={t("admin.title")}
        data-tooltip-pos="bottom"
      >
        <Icon icon={UsersIcon} size={14} />
        <span class="hidden sm:inline">{t("common.admin")}</span>
      </Button>
    {/if}

    {#if onOpenSettings}
      <Button
        variant="default"
        size="sm"
        onclick={onOpenSettings}
        data-tooltip={t("navbar.accountSettings")}
        data-tooltip-pos="bottom"
        class="max-w-[220px] gap-2 pl-1.5"
      >
        <span
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-light text-[10px] font-bold text-primary"
        >
          {session.displayName.charAt(0).toUpperCase()}
        </span>
        <span class="hidden truncate text-text sm:inline">{session.displayName}</span>
        <Icon icon={SettingsIcon} size={13} class="shrink-0 text-text-muted" />
      </Button>
    {/if}

    {#if onLogout}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={onLogout}
        data-tooltip={t("common.logout")}
        data-tooltip-pos="bottom"
        aria-label={t("common.logout")}
      >
        <Icon icon={LogOutIcon} size={14} />
      </Button>
    {/if}
  </div>
</header>
