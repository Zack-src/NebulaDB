<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { KeyIcon } from "@/components/icons/Icons";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchTotpStatus } from "@/services/authApi";
  import TotpSetupWizard from "./totp/TotpSetupWizard.svelte";
  import TotpDisableModal from "./totp/TotpDisableModal.svelte";
  import TotpRegenerateModal from "./totp/TotpRegenerateModal.svelte";
  import BackupCodesModal from "./totp/BackupCodesModal.svelte";

  /**
   * Enable/disable two-factor login and manage backup codes.
   *
   * The three flows here (enroll, disable, regenerate codes) are split into
   * their own modal components rather than one growing form: each has its own
   * confirmation requirements (a fresh code to prove enrollment; a password
   * *and* a code to turn it off; a password alone to reissue codes) and its
   * own one-time reveal of sensitive output, so keeping them separate keeps
   * each one's state honest about what it actually needs.
   */
  const { t } = useTranslation();
  const status = useAsyncResource(fetchTotpStatus);
  let wizardOpen = $state(false);
  let disableOpen = $state(false);
  let regenerateOpen = $state(false);
  // Shown once, right after either enrollment or a regeneration — same modal
  // for both, since the "save these now, they won't be shown again" message
  // is identical either way.
  let revealedCodes = $state.raw<string[] | null>(null);
</script>

<div class="pt-6 border-t border-border/60">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-sm font-bold text-text mb-1">{t("totp.title")}</h3>
      <p class="text-xs text-text-muted max-w-md">{t("totp.subtitle")}</p>
    </div>
    {#if status.data}
      <Badge tone={status.data.enabled ? "success" : "muted"}>
        {status.data.enabled ? t("totp.enabledBadge") : t("totp.disabledBadge")}
      </Badge>
    {/if}
  </div>

  {#if status.error}<ErrorText>{status.error}</ErrorText>{/if}

  <div class="mt-3 flex flex-wrap items-center gap-2">
    {#if status.data?.enabled}
      <span class="text-xs text-text-muted">
        {t("totp.backupCodesRemaining", { count: status.data.backupCodesRemaining })}
      </span>
      <Button size="sm" variant="outline" class="text-xs" onclick={() => (regenerateOpen = true)}>
        {t("totp.regenerateButton")}
      </Button>
      <Button size="sm" variant="danger-ghost" class="text-xs" onclick={() => (disableOpen = true)}>
        {t("totp.disableButton")}
      </Button>
    {:else}
      <Button variant="outline" class="gap-2 text-xs" onclick={() => (wizardOpen = true)}>
        <Icon icon={KeyIcon} size={14} />
        {t("totp.enableButton")}
      </Button>
    {/if}
  </div>

  {#if wizardOpen}
    <TotpSetupWizard
      onClose={() => (wizardOpen = false)}
      onEnabled={(codes) => {
        wizardOpen = false;
        revealedCodes = codes;
        status.reload();
      }}
    />
  {/if}
  {#if disableOpen}
    <TotpDisableModal
      onClose={() => (disableOpen = false)}
      onDisabled={() => {
        disableOpen = false;
        status.reload();
      }}
    />
  {/if}
  {#if regenerateOpen}
    <TotpRegenerateModal
      onClose={() => (regenerateOpen = false)}
      onRegenerated={(codes) => {
        regenerateOpen = false;
        revealedCodes = codes;
      }}
    />
  {/if}
  {#if revealedCodes}
    <BackupCodesModal codes={revealedCodes} onClose={() => (revealedCodes = null)} />
  {/if}
</div>
