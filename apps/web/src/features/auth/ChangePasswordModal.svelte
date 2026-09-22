<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { changeMyPassword } from "@/services/usersApi";

  const MIN_PASSWORD_LENGTH = 8;

  /** Self-service password change — requires the current password, unlike the admin reset in the admin console. */
  let { onClose }: { onClose: () => void } = $props();

  const { t } = useTranslation();
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmation = $state("");
  let validationError = $state<string | null>(null);
  let changed = $state(false);

  const changePassword = useAsyncAction(async () => {
    await changeMyPassword(currentPassword, newPassword);
    changed = true;
  });

  // A real <form> submit handler, so Enter in any of the three fields submits
  // — the browser default every password dialog is expected to honour, and
  // which a bare onclick on the button does not provide.
  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      validationError = t("changePassword.tooShort", { min: MIN_PASSWORD_LENGTH });
      return;
    }
    if (newPassword !== confirmation) {
      validationError = t("acceptInvite.passwordMismatch");
      return;
    }
    validationError = null;
    void changePassword.run();
  }
</script>

<Modal title={t("changePassword.title")} {onClose}>
  {#if changed}
    <Hint>{t("changePassword.success")}</Hint>
  {:else}
    <form onsubmit={handleSubmit} novalidate>
      <Field
        label={t("changePassword.currentLabel")}
        type="password"
        autofocus
        bind:value={currentPassword}
        autocomplete="current-password"
      />
      <Field
        label={t("changePassword.newLabel")}
        type="password"
        bind:value={newPassword}
        autocomplete="new-password"
      />
      <Field
        label={t("changePassword.confirmLabel")}
        type="password"
        bind:value={confirmation}
        autocomplete="new-password"
      />
      <Button
        variant="primary"
        type="submit"
        disabled={changePassword.pending || !currentPassword || !newPassword || !confirmation}
      >
        {changePassword.pending ? t("changePassword.submitting") : t("changePassword.title")}
      </Button>
      {#if validationError ?? changePassword.error}
        <ErrorText>{validationError ?? changePassword.error}</ErrorText>
      {/if}
    </form>
  {/if}
</Modal>
