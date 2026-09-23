<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { LogoMarkIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { confirmPasswordReset } from "@/services/authApi";

  const MIN_PASSWORD_LENGTH = 8;

  /**
   * Landing page for an emailed `/reset-password/:token` link — same layout
   * and same "no session, go log in for real" rule as `AcceptInvite`, so the
   * browser's password manager sees a genuine login with the new password.
   */
  let { token, onDone }: { token: string; onDone: (email: string) => void } = $props();

  const { t } = useTranslation();
  let password = $state("");
  let confirmation = $state("");
  let validationError = $state<string | null>(null);

  const save = useAsyncAction(async () => {
    const { email } = await confirmPasswordReset(token, password);
    onDone(email);
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      validationError = t("acceptInvite.passwordTooShort", { min: MIN_PASSWORD_LENGTH });
      return;
    }
    if (password !== confirmation) {
      validationError = t("acceptInvite.passwordMismatch");
      return;
    }
    validationError = null;
    void save.run();
  }
</script>

<div class="flex h-full items-center justify-center p-6">
  <form
    class="flex w-full max-w-[340px] flex-col rounded-md border border-border bg-surface p-7 shadow-md"
    onsubmit={handleSubmit}
  >
    <span
      class="mx-auto mb-3 flex h-[26px] w-[26px] items-center justify-center rounded-sm bg-gradient-to-br from-primary to-[#7c3aed] text-white"
    >
      <Icon icon={LogoMarkIcon} size={16} style="color: white" />
    </span>
    <h1 class="mb-1 text-center text-lg font-bold">{t("resetPassword.title")}</h1>
    <p class="mb-5 text-center text-[13px] text-text-muted">{t("resetPassword.subtitle")}</p>
    <Field
      label={t("resetPassword.newPassword")}
      type="password"
      autofocus
      bind:value={password}
      autocomplete="new-password"
    />
    <Field
      label={t("acceptInvite.confirmPassword")}
      type="password"
      bind:value={confirmation}
      autocomplete="new-password"
    />
    <Button variant="primary" type="submit" disabled={save.pending || !password || !confirmation}>
      {save.pending ? t("resetPassword.saving") : t("resetPassword.save")}
    </Button>
    {#if validationError ?? save.error}
      <ErrorText>{validationError ?? save.error}</ErrorText>
    {/if}
  </form>
</div>
