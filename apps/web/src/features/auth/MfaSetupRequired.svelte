<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import TwoFactorAuth from "@/features/settings/TwoFactorAuth.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchTotpStatus } from "@/services/authApi";

  /**
   * Blocking screen shown while the instance requires 2FA and this account has
   * not enabled it. It reuses the settings enrolment flow, then asks the parent
   * to refresh the session once 2FA is on.
   */
  const { onDone, onLogout }: { onDone: () => void; onLogout: () => void } = $props();
  const { t } = useTranslation();

  // The enrolment component reloads its own status; poll lightly to notice completion.
  $effect(() => {
    const timer = setInterval(() => {
      fetchTotpStatus()
        .then((status) => {
          if (status.enabled) onDone();
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-bg p-4">
  <div class="w-full max-w-lg rounded-lg border border-border bg-surface p-6">
    <h1 class="text-lg font-bold text-text mb-1">{t("mfaRequired.title")}</h1>
    <p class="text-xs text-text-muted mb-2">{t("mfaRequired.message")}</p>
    <TwoFactorAuth />
    <div class="mt-4 flex justify-end">
      <Button size="sm" variant="ghost" onclick={onLogout}>{t("common.logout")}</Button>
    </div>
  </div>
</div>
