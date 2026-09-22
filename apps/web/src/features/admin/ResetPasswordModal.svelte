<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { resetUserPassword } from "@/services/usersApi";
  import type { UserSummary } from "@/types";

  const MIN_PASSWORD_LENGTH = 8;

  let { targetUser, onClose }: { targetUser: UserSummary; onClose: () => void } = $props();

  const { t } = useTranslation();
  let newPassword = $state("");
  let confirmation = $state("");
  let validationError = $state<string | null>(null);
  let reset = $state(false);

  const resetPassword = useAsyncAction(async () => {
    await resetUserPassword(targetUser.id, newPassword);
    reset = true;
  });

  function handleSubmit() {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      validationError = t("acceptInvite.passwordTooShort", { min: MIN_PASSWORD_LENGTH });
      return;
    }
    if (newPassword !== confirmation) {
      validationError = t("acceptInvite.passwordMismatch");
      return;
    }
    validationError = null;
    void resetPassword.run();
  }
</script>

<Modal title={t("admin.resetPassword.title", { email: targetUser.email })} {onClose}>
  {#if reset}
    <Hint>{t("admin.resetPassword.success", { email: targetUser.email })}</Hint>
  {:else}
    <Field
      label={t("changePassword.newLabel")}
      type="password"
      autofocus
      bind:value={newPassword}
      autocomplete="new-password"
    />
    <Field
      label={t("changePassword.confirmLabel")}
      type="password"
      bind:value={confirmation}
      autocomplete="new-password"
    />
    <Button variant="primary" onclick={handleSubmit} disabled={resetPassword.pending || !newPassword || !confirmation}>
      {resetPassword.pending ? t("admin.resetPassword.submitting") : t("admin.users.resetPassword")}
    </Button>
    {#if validationError ?? resetPassword.error}<ErrorText>{validationError ?? resetPassword.error}</ErrorText>{/if}
  {/if}
</Modal>
