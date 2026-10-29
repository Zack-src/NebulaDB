<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { resetUserPassword } from "@/services/usersApi";
  import type { UserSummary } from "@/types";
  import { copyText } from "@/utils/clipboard";
  import { generatePassword } from "@/utils/password";

  const MIN_PASSWORD_LENGTH = 8;

  let { targetUser, onClose }: { targetUser: UserSummary; onClose: () => void } = $props();

  const { t } = useTranslation();
  let newPassword = $state("");
  let confirmation = $state("");
  let validationError = $state<string | null>(null);
  let reset = $state(false);
  /** A generated password is shown in clear: the administrator has to pass it on, and it is never shown again. */
  let generated = $state(false);

  const resetPassword = useAsyncAction(async () => {
    await resetUserPassword(targetUser.id, newPassword);
    reset = true;
  });

  function generate() {
    newPassword = generatePassword();
    confirmation = newPassword;
    generated = true;
    validationError = null;
  }

  async function copy() {
    if (await copyText(newPassword)) toast.success(t("common.copied"));
  }

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
    {#if generated}
      <div class="mt-3 flex items-center gap-2">
        <Input class="min-w-0 flex-1 font-mono" value={newPassword} readonly aria-label={t("changePassword.newLabel")} />
        <Button onclick={() => void copy()}>{t("common.copy")}</Button>
      </div>
      <Hint>{t("admin.resetPassword.generatedHint")}</Hint>
    {/if}
  {:else}
    <Field
      label={t("changePassword.newLabel")}
      type={generated ? "text" : "password"}
      autofocus
      bind:value={newPassword}
      oninput={() => (generated = false)}
      autocomplete="new-password"
    />
    <Field
      label={t("changePassword.confirmLabel")}
      type={generated ? "text" : "password"}
      bind:value={confirmation}
      autocomplete="new-password"
    />
    {#if generated}<Hint>{t("admin.resetPassword.generatedHint")}</Hint>{/if}
    <div class="flex items-center gap-2">
      <Button onclick={generate} disabled={resetPassword.pending}>{t("admin.resetPassword.generate")}</Button>
      <Button
        variant="primary"
        onclick={handleSubmit}
        disabled={resetPassword.pending || !newPassword || !confirmation}
      >
        {resetPassword.pending ? t("admin.resetPassword.submitting") : t("admin.users.resetPassword")}
      </Button>
    </div>
    {#if validationError ?? resetPassword.error}<ErrorText>{validationError ?? resetPassword.error}</ErrorText>{/if}
  {/if}
</Modal>
