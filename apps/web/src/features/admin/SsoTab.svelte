<script lang="ts">
  import PageIntro from "@/components/layout/PageIntro.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchSsoSettings, saveSsoSettings, testSsoSettings } from "@/services/ssoApi";

  /**
   * Single sign-on through one OpenID Connect provider. The redirect URI shown
   * here is what the administrator registers at the provider; the secret is
   * never sent back, only "one is stored".
   */
  const { t } = useTranslation();
  const LABEL = "mb-1 block text-xs font-medium text-text-muted";
  const uid = $props.id();

  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let redirectUri = $state("");
  let enabled = $state(false);
  let issuer = $state("");
  let clientId = $state("");
  let clientSecret = $state("");
  let hasClientSecret = $state(false);
  let removeSecret = $state(false);
  let buttonLabel = $state("");
  let autoCreate = $state(false);
  let domains = $state("");

  function apply(response: Awaited<ReturnType<typeof fetchSsoSettings>>) {
    const { settings } = response;
    redirectUri = response.redirectUri;
    enabled = settings.enabled;
    issuer = settings.issuer;
    clientId = settings.clientId;
    hasClientSecret = settings.hasClientSecret;
    clientSecret = "";
    removeSecret = false;
    buttonLabel = settings.buttonLabel;
    autoCreate = settings.autoCreate;
    domains = settings.allowedDomains.join(", ");
    loaded = true;
  }

  $effect(() => {
    fetchSsoSettings()
      .then(apply)
      .catch((err: unknown) => (loadError = err instanceof Error ? err.message : String(err)));
  });

  function input() {
    return {
      enabled,
      issuer: issuer.trim(),
      clientId: clientId.trim(),
      clientSecret: removeSecret ? null : clientSecret,
      buttonLabel: buttonLabel.trim(),
      autoCreate,
      allowedDomains: domains
        .split(/[,\s]+/)
        .map((domain) => domain.trim())
        .filter(Boolean),
    };
  }

  let testResult = $state<string | null>(null);
  const test = useAsyncAction(async () => {
    testResult = null;
    const result = await testSsoSettings(input());
    testResult = t("admin.sso.testOk", { endpoint: result.authorizationEndpoint });
  });

  const save = useAsyncAction(async () => {
    apply(await saveSsoSettings(input()));
    toast.success(t("admin.sso.saved"));
  });

  async function copyRedirect() {
    await navigator.clipboard?.writeText(redirectUri).catch(() => {});
    toast.info(t("admin.sso.copied"));
  }
</script>

<div class="space-y-4" data-testid="sso-settings">
  <PageIntro>{t("admin.sso.hint")}</PageIntro>

  {#if loadError}<ErrorText>{loadError}</ErrorText>{/if}
  {#if loaded}
    <div>
      <div class={LABEL}>{t("admin.sso.redirectUri")}</div>
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs"
          >{redirectUri}</code
        >
        <Button size="sm" variant="ghost" onclick={() => void copyRedirect()}>{t("admin.sso.copy")}</Button>
      </div>
      <Hint>{t("admin.sso.redirectUriHint")}</Hint>
    </div>

    <div>
      <label class={LABEL} for={`${uid}-issuer`}>{t("admin.sso.issuer")}</label>
      <input
        id={`${uid}-issuer`}
        class={`${INPUT_CLASS} w-full`}
        bind:value={issuer}
        placeholder="https://keycloak.example.com/realms/acme"
        spellcheck={false}
      />
      <Hint>{t("admin.sso.issuerHint")}</Hint>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class={LABEL} for={`${uid}-client`}>{t("admin.sso.clientId")}</label>
        <input id={`${uid}-client`} class={`${INPUT_CLASS} w-full`} bind:value={clientId} spellcheck={false} />
      </div>
      <div>
        <label class={LABEL} for={`${uid}-secret`}>{t("admin.sso.clientSecret")}</label>
        <input
          id={`${uid}-secret`}
          type="password"
          class={`${INPUT_CLASS} w-full`}
          bind:value={clientSecret}
          autocomplete="new-password"
          placeholder={hasClientSecret && !removeSecret ? "••••••••" : ""}
          oninput={() => (removeSecret = false)}
        />
        {#if hasClientSecret && !removeSecret && !clientSecret}
          <Button size="xs" variant="ghost" class="mt-1" onclick={() => (removeSecret = true)}>
            {t("admin.sso.removeSecret")}
          </Button>
        {/if}
      </div>
    </div>
    <Hint>{t("admin.sso.secretHint")}</Hint>

    <div>
      <label class={LABEL} for={`${uid}-label`}>{t("admin.sso.buttonLabel")}</label>
      <input
        id={`${uid}-label`}
        class={`${INPUT_CLASS} w-full`}
        bind:value={buttonLabel}
        maxlength={80}
        placeholder={t("login.sso.default")}
      />
    </div>

    <div>
      <label class={LABEL} for={`${uid}-domains`}>{t("admin.sso.domains")}</label>
      <input
        id={`${uid}-domains`}
        class={`${INPUT_CLASS} w-full`}
        bind:value={domains}
        placeholder="acme.com, acme.fr"
        spellcheck={false}
      />
      <Hint>{t("admin.sso.domainsHint")}</Hint>
    </div>

    <Checkbox bind:checked={autoCreate} hint={t("admin.sso.autoCreateHint")}>
      <span class="text-xs">{t("admin.sso.autoCreate")}</span>
    </Checkbox>

    <Checkbox bind:checked={enabled} hint={t("admin.sso.enabledHint")}>
      <span class="text-xs">{t("admin.sso.enabled")}</span>
    </Checkbox>

    {#if testResult}
      <p class="m-0 rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-400" role="status">
        {testResult}
      </p>
    {/if}
    {#if test.error}<ErrorText>{test.error}</ErrorText>{/if}
    {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}

    <div class="flex items-center justify-between gap-2 border-t border-border pt-4">
      <Button size="sm" variant="ghost" onclick={() => void test.run()} disabled={test.pending || !issuer.trim() || !clientId.trim()}>
        {test.pending ? t("common.loading") : t("admin.sso.test")}
      </Button>
      <Button size="sm" variant="primary" onclick={() => void save.run()} disabled={save.pending}>
        {save.pending ? t("common.saving") : t("common.save")}
      </Button>
    </div>
  {/if}
</div>
