<script lang="ts" module>
  import type { TranslationKeyOf } from "@/types";

  const SECTIONS = [
    { key: "invitations", labelKey: "admin.section.invitations" },
    { key: "teams", labelKey: "admin.section.teams" },
    { key: "users", labelKey: "admin.section.users" },
    { key: "audit", labelKey: "admin.section.audit" },
    { key: "errors", labelKey: "admin.section.errors" },
    { key: "connections", labelKey: "admin.section.connections" },
  ] as const satisfies readonly { key: string; labelKey: TranslationKeyOf }[];

  type Section = (typeof SECTIONS)[number]["key"];
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon } from "@/components/icons/Icons";
  import AuditTab from "@/features/admin/AuditTab.svelte";
  import ConnectionsTab from "@/features/admin/ConnectionsTab.svelte";
  import ErrorsTab from "@/features/admin/ErrorsTab.svelte";
  import InvitationsTab from "@/features/admin/InvitationsTab.svelte";
  import TeamsTab from "@/features/admin/TeamsTab.svelte";
  import UsersTab from "@/features/admin/UsersTab.svelte";
  import Button from "@/components/ui/Button.svelte";
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import { APP_HEADER, APP_SHELL } from "@/components/ui/layout";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const { t } = useTranslation();
  let section = $state<Section>("invitations");
</script>

<div class={APP_SHELL}>
  <header class={APP_HEADER}>
    <Button variant="ghost" size="icon" onclick={onClose} data-tooltip={t("admin.backToProjects")}>
      <Icon icon={ChevronLeftIcon} size={16} />
    </Button>
    <BrandMark size={24} iconSize={13} />
    <span class="mr-1.5 whitespace-nowrap text-[13.5px] font-semibold">{t("admin.title")}</span>
  </header>
  <div class="h-full overflow-y-auto px-6 py-12">
    <div class="mx-auto max-w-[880px]">
      <div class="mb-[18px] flex gap-3.5 border-b border-border">
        {#each SECTIONS as { key, labelKey } (key)}
          <button
            class={`-mb-px border-b-2 py-2 text-[13px] font-semibold ${
              section === key ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"
            }`}
            onclick={() => (section = key)}
          >
            {t(labelKey)}
          </button>
        {/each}
      </div>
      {#if section === "invitations"}<InvitationsTab />{/if}
      {#if section === "teams"}<TeamsTab />{/if}
      {#if section === "users"}<UsersTab />{/if}
      {#if section === "audit"}<AuditTab />{/if}
      {#if section === "errors"}<ErrorsTab />{/if}
      {#if section === "connections"}<ConnectionsTab />{/if}
    </div>
  </div>
</div>
