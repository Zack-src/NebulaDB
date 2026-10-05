<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Session } from "@/types";
  import type { ShellView } from "@/app/shellNavigation";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import {
    ChevronRightIcon,
    DatabaseIcon,
    FolderIcon,
    LogOutIcon,
    SettingsIcon,
    UsersIcon,
  } from "@/components/icons/Icons";
  import NotificationBell from "@/features/notifications/NotificationBell.svelte";
  import { APP_NAME } from "@/components/layout/Navbar.svelte";

  let {
    session,
    view,
    projectName,
    onNavigate,
    onLogout,
    onOpenProject,
    children,
  }: {
    session: Session;
    view: ShellView;
    projectName?: string;
    onNavigate: (view: ShellView) => void;
    onLogout: () => void;
    onOpenProject: (id: string) => void;
    children: Snippet;
  } = $props();
  const { t } = useTranslation();
  const navigation = $derived([
    { id: "app" as const, label: t("projects.title"), icon: FolderIcon },
    { id: "bases" as const, label: t("shell.bases"), icon: DatabaseIcon },
    ...(session.isAdmin ? [{ id: "admin" as const, label: t("common.admin"), icon: UsersIcon }] : []),
  ]);
  const active = $derived(projectName ? "app" : view);
  const heading = $derived(
    view === "settings"
      ? t("navbar.accountSettings")
      : view === "admin"
        ? t("admin.title")
        : (navigation.find((n) => n.id === view)?.label ?? t("projects.title")),
  );
</script>

<div class="workspace-shell">
  <a
    class="skip-link"
    href="#workspace-content"
    onclick={(event) => {
      event.preventDefault();
      document.getElementById("workspace-content")?.focus();
    }}>{t("shell.skipToContent")}</a
  >
  <aside class="workspace-sidebar" aria-label={t("shell.navigation")}>
    <button class="workspace-brand" onclick={() => onNavigate("app")} aria-label="AthanorDB">
      <span class="brand-monogram" aria-hidden="true">A</span><span class="sidebar-label">{APP_NAME}</span>
    </button>
    <nav class="workspace-nav" aria-label={t("shell.navigation")}>
      {#each navigation as item (item.id)}
        <button
          onclick={() => onNavigate(item.id)}
          aria-current={active === item.id ? "page" : undefined}
          aria-label={item.label}
          title={item.label}
        >
          <Icon icon={item.icon} size={17} /><span class="sidebar-label">{item.label}</span>
        </button>
      {/each}
    </nav>
    <div class="sidebar-spacer"></div>
    <button
      class="workspace-account"
      onclick={() => onNavigate("settings")}
      aria-current={view === "settings" ? "page" : undefined}
      aria-label={t("navbar.accountSettings")}
      title={t("navbar.accountSettings")}
    >
      <span class="account-avatar" aria-hidden="true">{session.displayName.charAt(0).toUpperCase()}</span>
      <span class="sidebar-label account-copy"
        ><strong>{session.displayName}</strong><small>{session.isAdmin ? t("admin.title") : session.email}</small></span
      >
      <span class="sidebar-label"><Icon icon={SettingsIcon} size={15} /></span>
    </button>
    <button class="workspace-logout" onclick={onLogout} aria-label={t("common.logout")} title={t("common.logout")}>
      <Icon icon={LogOutIcon} size={15} /><span class="sidebar-label">{t("common.logout")}</span>
    </button>
  </aside>
  <div class="workspace-main">
    {#if !projectName}
      <header class="workspace-header">
        <nav aria-label={t("shell.breadcrumb")} class="workspace-breadcrumb">
          <span>{APP_NAME}</span><Icon icon={ChevronRightIcon} size={12} /><strong>{heading}</strong>
        </nav>
        <NotificationBell {onOpenProject} />
      </header>
    {/if}
    <main id="workspace-content" class="workspace-content" tabindex="-1">{@render children()}</main>
  </div>
</div>

<style>
  .workspace-shell {
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);
    height: 100dvh;
    overflow: hidden;
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 13px;
  }
  .workspace-sidebar {
    display: flex;
    min-height: 0;
    flex-direction: column;
    padding: 12px 10px;
    gap: 4px;
    border-right: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .workspace-brand {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 4px 8px 18px;
    font-size: 14px;
    font-weight: 600;
  }
  .brand-monogram {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--color-text-on-accent);
    background: var(--color-primary);
  }
  .workspace-nav {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .workspace-nav button,
  .workspace-logout {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 9px;
    border-radius: 7px;
    color: var(--color-text-secondary);
    text-align: left;
  }
  .workspace-nav button:hover,
  .workspace-logout:hover,
  .workspace-account:hover {
    background: var(--color-surface-hover);
  }
  .workspace-nav button[aria-current="page"],
  .workspace-account[aria-current="page"] {
    background: var(--color-primary-light);
    color: var(--color-primary-text);
    font-weight: 600;
  }
  .sidebar-spacer {
    flex: 1;
  }
  .workspace-account {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 8px;
    border-top: 1px solid var(--color-border);
    text-align: left;
    min-width: 0;
    border-radius: 7px;
  }
  .account-avatar {
    flex: none;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--color-primary-light);
    color: var(--color-primary-text);
    font-size: 11px;
    font-weight: 600;
  }
  .account-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .account-copy strong {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .account-copy small {
    color: var(--color-text-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .workspace-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    flex: none;
    padding: 0 20px;
    gap: 12px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .workspace-breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-muted);
    min-width: 0;
  }
  .workspace-breadcrumb strong {
    color: var(--color-text);
    font-weight: 600;
  }
  .workspace-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .skip-link {
    position: absolute;
    left: 12px;
    top: -100px;
    padding: 10px 16px;
    border-radius: 6px;
    background: var(--color-surface-raised);
    z-index: 100;
  }
  .skip-link:focus {
    top: 12px;
  }
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--color-primary-text);
    outline-offset: 2px;
  }
  @media (max-width: 767px) {
    .workspace-shell {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    .workspace-sidebar {
      padding: 10px 5px;
    }
    .sidebar-label {
      display: none;
    }
    .workspace-brand {
      padding: 4px 10px 18px;
    }
    .workspace-nav button,
    .workspace-logout {
      justify-content: center;
      padding: 11px 8px;
    }
    .workspace-account {
      justify-content: center;
      padding: 12px 0;
    }
    .workspace-header {
      padding: 0 12px;
    }
    .workspace-breadcrumb > span {
      display: none;
    }
  }
</style>
