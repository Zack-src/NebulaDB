<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { verifyTotpLogin } from "@/services/authApi";
  import type { Session } from "@/types";

  /** Second step of a 2FA login — a live authenticator code, or a backup code as a lost-device fallback. */
  let {
    mfaToken,
    onBack,
    onVerified,
  }: { mfaToken: string; onBack: () => void; onVerified: (session: Session) => void } = $props();

  const { t } = useTranslation();
  let code = $state("");
  let useBackupCode = $state(false);

  const verify = useAsyncAction(async () => {
    onVerified(await verifyTotpLogin(mfaToken, code.trim()));
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    void verify.run();
  }
</script>

<form onsubmit={handleSubmit} class="space-y-4">
  <div>
    <h2 class="text-sm font-bold text-text">{t("login.mfa.title")}</h2>
    <p class="mt-1 text-xs text-text-muted">{t("login.mfa.subtitle")}</p>
  </div>

  <Field
    label={useBackupCode ? t("totp.disableCodeLabel") : t("totp.codeLabel")}
    type="text"
    autofocus
    autocomplete="one-time-code"
    placeholder={useBackupCode ? t("login.mfa.backupCodePlaceholder") : t("login.mfa.codePlaceholder")}
    value={code}
    oninput={(event) => {
      const raw = event.currentTarget.value;
      code = useBackupCode ? raw : raw.replace(/[^0-9]/g, "").slice(0, 6);
      event.currentTarget.value = code;
    }}
  />

  <Button variant="primary" size="lg" type="submit" disabled={verify.pending || !code.trim()} class="w-full">
    {verify.pending ? t("login.mfa.verifying") : t("login.mfa.verify")}
  </Button>

  {#if verify.error}<ErrorText>{verify.error}</ErrorText>{/if}

  <div class="flex items-center justify-between text-[11px]">
    <button type="button" class="text-text-muted hover:text-text underline-offset-2 hover:underline" onclick={onBack}>
      {t("login.mfa.back")}
    </button>
    <button
      type="button"
      class="text-text-muted hover:text-text underline-offset-2 hover:underline"
      onclick={() => {
        useBackupCode = !useBackupCode;
        code = "";
        verify.clearError();
      }}
    >
      {useBackupCode ? t("login.mfa.useAuthenticatorCode") : t("login.mfa.useBackupCode")}
    </button>
  </div>
</form>
