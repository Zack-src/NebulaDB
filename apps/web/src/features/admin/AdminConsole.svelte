<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon } from "@/components/icons/Icons";
  import ActivityTab from "@/features/admin/ActivityTab.svelte";
  import ConnectionsTab from "@/features/admin/ConnectionsTab.svelte";
  import EnvironmentsTab from "@/features/admin/EnvironmentsTab.svelte";
  import ErrorsTab from "@/features/admin/ErrorsTab.svelte";
  import LintPresetsTab from "@/features/admin/lint/LintPresetsTab.svelte";
  import ShareLinksTab from "@/features/admin/ShareLinksTab.svelte";
  import TeamsTab from "@/features/admin/TeamsTab.svelte";
  import SsoTab from "@/features/admin/SsoTab.svelte";
  import UsersTab from "@/features/admin/UsersTab.svelte";
  import Button from "@/components/ui/Button.svelte";
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import { APP_HEADER, APP_SHELL } from "@/components/ui/layout";
  import { ADMIN_SECTIONS as SECTIONS, type AdminSection as Section } from "@/features/admin/adminSections";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let {
    onClose,
    embedded = false,
    initialSection = "users",
    initialConnectionId,
  }: {
    onClose: () => void;
    embedded?: boolean;
    initialSection?: Section;
    /** Opens that connection's console as soon as the connections tab has loaded — from the global palette. */
    initialConnectionId?: string;
  } = $props();

  const { t } = useTranslation();
  let section = $derived<Section>(initialSection);
  const groups = [
    { label: "shell.people", keys: ["users", "teams", "sso"] },
    { label: "shell.bases", keys: ["connections", "environments"] },
    { label: "shell.quality", keys: ["lint"] },
    { label: "admin.group.sharing", keys: ["shareLinks"] },
    { label: "shell.logs", keys: ["audit", "errors"] },
  ] as const;
</script>

<div class={embedded ? "flex min-h-0 min-w-0 flex-1 flex-col bg-bg" : APP_SHELL}>
  {#if !embedded}
    <header class={APP_HEADER}>
      <Button variant="ghost" size="icon" onclick={onClose} data-tooltip={t("admin.backToProjects")}>
        <Icon icon={ChevronLeftIcon} size={16} />
      </Button>
      <BrandMark size={24} iconSize={13} />
      <span class="mr-1.5 whitespace-nowrap text-[13.5px] font-semibold">{t("admin.title")}</span>
    </header>
  {/if}
  <div class="admin-workspace">
    <nav class="admin-navigation" aria-label={t("admin.title")}>
      {#each groups as group (group.label)}
        <div class="admin-group">
          <h2>{t(group.label)}</h2>
          {#each SECTIONS.filter((item) => (group.keys as readonly string[]).includes(item.key)) as item (item.key)}
            <button aria-current={section === item.key ? "page" : undefined} onclick={() => (section = item.key)}
              >{t(item.labelKey)}</button
            >
          {/each}
        </div>
      {/each}
    </nav>
    <div class="admin-content">
      <!-- The connections section hosts a data grid and a SQL console, which need the width the list tabs don't. -->
      <div class={`mx-auto ${section === "connections" ? "max-w-[1600px]" : "max-w-[880px]"}`}>
        {#if section === "teams"}<TeamsTab />{/if}
        {#if section === "users"}
          <h2 class="mb-4 text-lg font-semibold">{t("admin.section.users")}</h2>
          <UsersTab />
        {/if}
        {#if section === "audit"}<ActivityTab />{/if}
        {#if section === "errors"}<ErrorsTab />{/if}
        {#if section === "connections"}<ConnectionsTab {initialConnectionId} />{/if}
        {#if section === "environments"}<EnvironmentsTab />{/if}
        {#if section === "lint"}<LintPresetsTab />{/if}
        {#if section === "sso"}<SsoTab />{/if}
        {#if section === "shareLinks"}<ShareLinksTab />{/if}
      </div>
    </div>
  </div>
</div>

<style>
  .admin-workspace {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }
  .admin-navigation {
    overflow: auto;
    border-right: 1px solid var(--color-border);
    padding: 16px 10px;
    background: var(--color-surface);
  }
  .admin-group {
    margin-bottom: 20px;
  }
  .admin-group h2 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    font-weight: 600;
    padding: 0 9px 6px;
  }
  .admin-group button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px 9px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .admin-group button:hover {
    background: var(--color-surface-hover);
  }
  .admin-group button[aria-current="page"] {
    background: var(--color-primary-light);
    color: var(--color-primary-text);
    font-weight: 600;
  }
  .admin-group button:focus-visible {
    outline: 2px solid var(--color-primary-text);
    outline-offset: 2px;
  }
  .admin-content {
    min-width: 0;
    overflow: auto;
    padding: 24px;
  }
  @media (max-width: 1023px) {
    .admin-workspace {
      grid-template-columns: 1fr;
    }
    .admin-navigation {
      display: flex;
      gap: 16px;
      border-right: 0;
      border-bottom: 1px solid var(--color-border);
      padding: 8px 12px;
    }
    .admin-group {
      display: flex;
      flex: none;
      gap: 4px;
      margin: 0;
    }
    .admin-group h2 {
      display: none;
    }
    .admin-group button {
      width: auto;
      white-space: nowrap;
    }
    .admin-content {
      padding: 20px 16px;
    }
  }
</style>
