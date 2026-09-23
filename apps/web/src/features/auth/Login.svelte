<script lang="ts">
  import { APP_NAME } from "@/components/layout/Navbar.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { KeyIcon, LogoMarkIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Tabs from "@/components/ui/Tabs.svelte";
  import Card from "@/components/ui/Card.svelte";
  import CardBody from "@/components/ui/CardBody.svelte";
  import CardHeader from "@/components/ui/CardHeader.svelte";
  import { CHECKBOX_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchAuthFeatures, login } from "@/services/authApi";
  import type { Session } from "@/types";
  import MfaStep from "./MfaStep.svelte";
  import ForgotPasswordStep from "./ForgotPasswordStep.svelte";

  type LoginTab = "login" | "invite";

  let {
    onLoggedIn,
    initialEmail,
    initialNotice = "accountCreated",
  }: {
    onLoggedIn: (session: Session) => void;
    /** Pre-fills the email field and shows a "your account is ready" banner —
     * set right after a user finishes creating their account via an invitation
     * link, so this first sign-in reads as the deliberate next step rather
     * than a login prompt out of nowhere. */
    initialEmail?: string;
    /** Which banner accompanies `initialEmail`: arriving from an invitation, or from a password reset. */
    initialNotice?: "accountCreated" | "passwordReset";
  } = $props();

  const { t } = useTranslation();
  let tab = $state<LoginTab>("login");
  // svelte-ignore state_referenced_locally
  let email = $state(initialEmail ?? "");
  let password = $state("");
  // Defaults to the historical 30-day session. Unchecking gives a 12-hour one
  // in a cookie the browser drops when it closes — for a shared machine.
  let remember = $state(true);

  // Set once the password step succeeds on a 2FA-enabled account — its
  // presence is what switches the form below to the verification step, so
  // clearing it (the "back to login" link) is enough to return to step one.
  let mfaToken = $state<string | null>(null);
  let forgotOpen = $state(false);
  // Only offered when the server can actually send the email — a link that
  // leads to "this instance has no email" is worse than no link.
  let passwordResetAvailable = $state(false);
  $effect(() => {
    fetchAuthFeatures()
      .then((features) => (passwordResetAvailable = features.passwordReset))
      .catch(() => {});
  });

  const signIn = useAsyncAction(async () => {
    const result = await login({ email: email.trim(), password, remember });
    if ("mfaRequired" in result) {
      mfaToken = result.mfaToken;
      return;
    }
    onLoggedIn(result);
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    void signIn.run();
  }
</script>

<div class="relative min-h-screen w-full flex items-center justify-center p-6 bg-bg overflow-hidden gradient-bg-hero">
  <!-- Glow backdrop shapes -->
  <div
    class="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-primary/20 blur-[130px] rounded-full pointer-events-none"
  ></div>
  <div
    class="absolute bottom-10 right-10 w-[300px] h-[300px] bg-accent-purple/15 blur-[100px] rounded-full pointer-events-none"
  ></div>

  <div class="relative w-full max-w-[420px] flex flex-col gap-4">
    <Card variant="glow" class="w-full shadow-xl glass-panel">
      <CardHeader class="border-b border-border/40 pb-4 text-center">
        <div
          class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent-purple text-white shadow-md"
        >
          <Icon icon={LogoMarkIcon} size={20} style="color: white" />
        </div>
        <h1 class="text-xl font-extrabold tracking-tight">{APP_NAME}</h1>
        <p class="mt-1 text-xs text-text-muted">{t("login.tagline")}</p>
      </CardHeader>

      <CardBody class="space-y-5">
        {#if initialEmail && !mfaToken && !forgotOpen}
          <p class="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            {initialNotice === "passwordReset" ? t("login.passwordReset") : t("login.accountCreated")}
          </p>
        {/if}
        {#if mfaToken}
          <MfaStep {mfaToken} onBack={() => (mfaToken = null)} onVerified={onLoggedIn} />
        {:else if forgotOpen}
          <ForgotPasswordStep initialEmail={email.trim()} onBack={() => (forgotOpen = false)} />
        {:else}
          <Tabs
            variant="boxed"
            tabs={[
              { id: "login", label: t("login.tab.signIn") },
              { id: "invite", label: t("login.tab.invite") },
            ]}
            activeTab={tab}
            onChange={(next) => {
              tab = next as LoginTab;
              signIn.clearError();
            }}
          />

          {#if tab === "login"}
            <form onsubmit={handleSubmit} class="space-y-4">
              <Field
                label={t("login.emailLabel")}
                type="email"
                placeholder={t("login.emailPlaceholder")}
                autofocus={!initialEmail}
                bind:value={email}
                autocomplete="username"
              />
              <Field
                label={t("login.passwordLabel")}
                type="password"
                placeholder="••••••••"
                autofocus={Boolean(initialEmail)}
                bind:value={password}
                autocomplete="current-password"
              />

              <label class="flex items-start gap-2 text-xs text-text-secondary cursor-pointer select-none">
                <input type="checkbox" class={`${CHECKBOX_CLASS} mt-px`} bind:checked={remember} />
                <span>
                  {t("login.rememberMe")}
                  <span class="block text-[11px] text-text-muted">{t("login.rememberMeHint")}</span>
                </span>
              </label>

              <Button
                variant="primary"
                size="lg"
                type="submit"
                disabled={signIn.pending || !email.trim() || !password}
                class="w-full"
              >
                {signIn.pending ? t("login.signingIn") : t("login.signIn")}
              </Button>

              {#if signIn.error}<ErrorText>{signIn.error}</ErrorText>{/if}

              {#if passwordResetAvailable}
                <button
                  type="button"
                  class="block text-[11px] text-text-muted hover:text-text underline-offset-2 hover:underline"
                  onclick={() => {
                    signIn.clearError();
                    forgotOpen = true;
                  }}
                >
                  {t("login.forgot.link")}
                </button>
              {/if}
            </form>
          {/if}

          {#if tab === "invite"}
            <div class="space-y-4 text-xs text-text-secondary">
              <p>{t("login.inviteOnly")}</p>
              <div class="space-y-2 rounded-lg border border-border bg-surface-raised p-3.5">
                <div class="flex items-center gap-1.5 font-semibold text-text">
                  <Icon icon={KeyIcon} size={14} class="text-warning" />
                  {t("login.haveInviteLink")}
                </div>
                <p class="text-[11px] text-text-muted">{t("login.haveInviteLinkHint")}</p>
              </div>
            </div>
          {/if}
        {/if}
      </CardBody>
    </Card>
  </div>
</div>
