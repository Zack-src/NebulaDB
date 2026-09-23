<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { requestPasswordReset } from "@/services/authApi";

  /**
   * "Forgot password" inside the login card, same shape as `MfaStep`. The
   * confirmation is worded conditionally ("if an account exists…") on
   * purpose: the server gives the same answer for every address, and the UI
   * must not claim more than it knows.
   */
  let { initialEmail, onBack }: { initialEmail: string; onBack: () => void } = $props();

  const { t } = useTranslation();
  // svelte-ignore state_referenced_locally
  let email = $state(initialEmail);
  let sentTo = $state<string | null>(null);

  const send = useAsyncAction(async () => {
    await requestPasswordReset(email.trim());
    sentTo = email.trim();
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (email.trim()) void send.run();
  }
</script>

<form onsubmit={handleSubmit} class="space-y-4">
  <div>
    <h2 class="text-sm font-bold text-text">{t("login.forgot.title")}</h2>
    <p class="mt-1 text-xs text-text-muted">{t("login.forgot.subtitle")}</p>
  </div>

  {#if sentTo}
    <p class="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success" role="status">
      {t("login.forgot.sent", { email: sentTo })}
    </p>
  {:else}
    <Field
      label={t("login.emailLabel")}
      type="email"
      autofocus
      placeholder={t("login.emailPlaceholder")}
      bind:value={email}
      autocomplete="username"
    />
    <Button variant="primary" size="lg" type="submit" disabled={send.pending || !email.trim()} class="w-full">
      {send.pending ? t("login.forgot.sending") : t("login.forgot.send")}
    </Button>
    {#if send.error}<ErrorText>{send.error}</ErrorText>{/if}
  {/if}

  <button
    type="button"
    class="text-[11px] text-text-muted hover:text-text underline-offset-2 hover:underline"
    onclick={onBack}
  >
    {t("login.mfa.back")}
  </button>
</form>
