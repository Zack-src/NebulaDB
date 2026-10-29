<script lang="ts">
  import { APP_NAME } from "@/components/layout/Navbar.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { LogoMarkIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Card from "@/components/ui/Card.svelte";
  import CardBody from "@/components/ui/CardBody.svelte";
  import CardHeader from "@/components/ui/CardHeader.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Field from "@/components/ui/Field.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKey } from "@/i18n/translate";
  import { completeSetup } from "@/services/setupApi";
  import type { Session } from "@/types";
  import {
    SETUP_MAX_PASSWORD_LENGTH,
    SETUP_MIN_PASSWORD_LENGTH,
    checkSetupDraft,
    type SetupField,
    type SetupProblem,
  } from "./setupForm";

  /**
   * First-run setup: shown instead of the login form while the instance has no account at all. Creates the
   * first administrator, who is signed in straight away. The server refuses it for good once one account exists.
   */
  let {
    tokenRequired,
    onDone,
  }: {
    /** The operator set NEBULADB_SETUP_TOKEN: ask for it. */
    tokenRequired: boolean;
    onDone: (session: Session) => void;
  } = $props();

  const { t } = useTranslation();
  let email = $state("");
  let displayName = $state("");
  let password = $state("");
  let confirmation = $state("");
  let token = $state("");
  let invalid = $state<{ field: SetupField; problem: SetupProblem } | null>(null);

  const PROBLEM_KEYS: Record<SetupProblem, TranslationKey> = {
    required: "setup.error.required",
    emailInvalid: "setup.error.emailInvalid",
    tooShort: "setup.error.passwordTooShort",
    tooLong: "setup.error.passwordTooLong",
    mismatch: "setup.error.passwordMismatch",
  };

  function fieldError(field: SetupField): string | null {
    if (invalid?.field !== field) return null;
    return t(PROBLEM_KEYS[invalid.problem], { min: SETUP_MIN_PASSWORD_LENGTH, max: SETUP_MAX_PASSWORD_LENGTH });
  }

  const create = useAsyncAction(async (payload: Parameters<typeof completeSetup>[0]) => {
    onDone(await completeSetup(payload));
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const check = checkSetupDraft({ email, displayName, password, confirmation, token }, tokenRequired);
    if (!check.ok) {
      invalid = { field: check.field, problem: check.problem };
      return;
    }
    invalid = null;
    void create.run(check.payload);
  }
</script>

<main class="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-bg p-6 gradient-bg-hero">
  <div class="relative flex w-full max-w-[440px] flex-col gap-4">
    <Card variant="glow" class="w-full shadow-xl glass-panel">
      <CardHeader class="border-b border-border/40 pb-4 text-center">
        <div
          class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent-purple text-white shadow-md"
        >
          <Icon icon={LogoMarkIcon} size={20} style="color: white" />
        </div>
        <h1 class="text-xl font-extrabold tracking-tight">{t("setup.title", { app: APP_NAME })}</h1>
        <p class="mt-1 text-label text-text-muted">{t("setup.subtitle")}</p>
      </CardHeader>

      <CardBody>
        {#if !tokenRequired}
          <p class="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-label" role="note">
            {t("setup.noTokenWarning")}
          </p>
        {/if}
        <form onsubmit={handleSubmit} novalidate aria-label={t("setup.formLabel")}>
          {#if tokenRequired}
            <Field
              label={t("setup.tokenLabel")}
              hint={t("setup.tokenHint")}
              error={fieldError("token")}
              type="password"
              autocomplete="off"
              autofocus
              bind:value={token}
            />
          {/if}
          <Field
            label={t("login.emailLabel")}
            placeholder={t("login.emailPlaceholder")}
            error={fieldError("email")}
            type="email"
            autocomplete="username"
            autofocus={!tokenRequired}
            bind:value={email}
          />
          <Field
            label={t("setup.displayNameLabel")}
            error={fieldError("displayName")}
            autocomplete="name"
            maxlength={64}
            bind:value={displayName}
          />
          <Field
            label={t("login.passwordLabel")}
            hint={t("setup.passwordHint", { min: SETUP_MIN_PASSWORD_LENGTH })}
            error={fieldError("password")}
            type="password"
            autocomplete="new-password"
            bind:value={password}
          />
          <Field
            label={t("acceptInvite.confirmPassword")}
            error={fieldError("confirmation")}
            type="password"
            autocomplete="new-password"
            bind:value={confirmation}
          />
          <Button variant="primary" size="lg" type="submit" disabled={create.pending} class="w-full">
            {create.pending ? t("setup.creating") : t("setup.submit")}
          </Button>
          {#if create.error}<ErrorText>{create.error}</ErrorText>{/if}
        </form>
      </CardBody>
    </Card>
  </div>
</main>
