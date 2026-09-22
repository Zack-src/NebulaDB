<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { DownloadIcon, TrashIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { MY_DATA_EXPORT_URL } from "@/services/usersApi";
  import DeleteAccountModal from "./DeleteAccountModal.svelte";

  /**
   * The two rights a user has over their own data: get a copy of it, and have
   * the account removed. Both were missing entirely — deletion could only be
   * done by an administrator, and there was no export at all.
   */
  const { t } = useTranslation();
  let confirmOpen = $state(false);

  // A hard navigation rather than unwinding app state: once the account is
  // gone, every piece of in-memory state — session, projects, open document —
  // refers to something that no longer exists. Reloading is both simpler and
  // more honest than trying to tear it down gracefully.
  const returnToStart = () => window.location.assign("/");
</script>

<div class="pt-6 border-t border-border/60">
  <h3 class="text-sm font-bold text-text mb-1">{t("settings.personalData.title")}</h3>
  <p class="text-xs text-text-muted mb-4">{t("settings.personalData.description")}</p>

  <div class="flex flex-wrap gap-2">
    <a
      href={MY_DATA_EXPORT_URL}
      download
      class="inline-flex items-center gap-1.5 rounded-lg border border-border-strong/90 bg-surface-raised/50 px-3.5 py-1.5 text-[13px] font-semibold text-text transition-colors hover:border-primary/80 hover:bg-surface-hover"
    >
      <Icon icon={DownloadIcon} size={14} />
      {t("settings.personalData.export")}
    </a>
    <Button variant="danger" class="gap-1.5 text-xs" onclick={() => (confirmOpen = true)}>
      <Icon icon={TrashIcon} size={13} />
      {t("settings.personalData.deleteAccount")}
    </Button>
  </div>

  {#if confirmOpen}
    <DeleteAccountModal onClose={() => (confirmOpen = false)} onDeleted={returnToStart} />
  {/if}
</div>
