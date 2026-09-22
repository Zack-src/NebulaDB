<script lang="ts" module>
  const MIN_PASSWORD_LENGTH = 8;

  /**
   * Best-effort save into the browser's own password manager via the
   * Credential Management API (Chromium browsers). Not available everywhere
   * (Firefox/Safari lack it), which is fine: those browsers instead pick up
   * the credential from the real login form submission that follows.
   */
  async function tryStoreCredential(email: string, password: string): Promise<void> {
    try {
      const PasswordCredentialCtor = (window as unknown as { PasswordCredential?: new (data: unknown) => Credential })
        .PasswordCredential;
      if (!PasswordCredentialCtor || !navigator.credentials?.store) return;
      const credential = new PasswordCredentialCtor({ id: email, password, name: email });
      await navigator.credentials.store(credential);
    } catch {
      // Best effort only — never block account creation on this.
    }
  }
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { LogoMarkIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { acceptInvitation } from "@/services/invitationsApi";

  let {
    token,
    onAccepted,
  }: {
    token: string;
    /** Called once the account exists. The caller is responsible for sending
     * the user on to a real login — this component intentionally never
     * receives a session. */
    onAccepted: (email: string) => void;
  } = $props();

  const { t } = useTranslation();
  let password = $state("");
  let confirmation = $state("");
  let validationError = $state<string | null>(null);

  const createAccount = useAsyncAction(async () => {
    const { email } = await acceptInvitation(token, password);
    await tryStoreCredential(email, password);
    onAccepted(email);
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
    void createAccount.run();
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
    <h1 class="mb-1 text-center text-lg font-bold">{t("acceptInvite.title")}</h1>
    <p class="mb-5 text-center text-[13px] text-text-muted">{t("acceptInvite.subtitle")}</p>
    <Field
      label={t("login.passwordLabel")}
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
    <Button variant="primary" type="submit" disabled={createAccount.pending || !password || !confirmation}>
      {createAccount.pending ? t("acceptInvite.creating") : t("acceptInvite.createAccount")}
    </Button>
    {#if validationError ?? createAccount.error}
      <ErrorText>{validationError ?? createAccount.error}</ErrorText>
    {/if}
  </form>
</div>
