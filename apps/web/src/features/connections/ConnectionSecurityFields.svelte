<script lang="ts" module>
  import type { DatabaseConnectionConfig, DatabaseConnectionSummary } from "@nebuladb/shared";

  /** What the "Sécurité" tab edits: the connection's TLS settings and its SSH tunnel. */
  export interface SecurityForm {
    sslVerify: boolean;
    sslCa: string;
    sslCert: string;
    /** Typed in this time; empty keeps the stored one. */
    sslKey: string;
    removeSslKey: boolean;
    hasSslKey: boolean;
    sshEnabled: boolean;
    sshHost: string;
    sshPort: number;
    sshUser: string;
    sshAuth: "password" | "key";
    sshPassword: string;
    sshPrivateKey: string;
    sshPassphrase: string;
    sshFingerprint: string;
    /** What is already stored, so an empty field can say so. */
    sshHasPassword: boolean;
    sshHasPrivateKey: boolean;
  }

  export function securityForm(summary: DatabaseConnectionSummary | null): SecurityForm {
    const tunnel = summary?.sshTunnel;
    return {
      sslVerify: Boolean(summary?.sslVerify),
      sslCa: summary?.sslCa ?? "",
      sslCert: summary?.sslCert ?? "",
      sslKey: "",
      removeSslKey: false,
      hasSslKey: Boolean(summary?.hasSslKey),
      sshEnabled: Boolean(tunnel),
      sshHost: tunnel?.host ?? "",
      sshPort: tunnel?.port ?? 22,
      sshUser: tunnel?.user ?? "",
      sshAuth: tunnel?.hasPrivateKey ? "key" : "password",
      sshPassword: "",
      sshPrivateKey: "",
      sshPassphrase: "",
      sshFingerprint: tunnel?.hostKeyFingerprint ?? "",
      sshHasPassword: Boolean(tunnel?.hasPassword),
      sshHasPrivateKey: Boolean(tunnel?.hasPrivateKey),
    };
  }

  /**
   * The request's part for these settings. Secrets left empty keep the stored
   * ones (the server's rule); the other way of logging in to SSH is removed
   * (`null`), so a switch from password to key does not leave the password behind.
   */
  export function securityPayload(
    form: SecurityForm,
    tls: boolean,
    tunnelPossible: boolean,
  ): Pick<DatabaseConnectionConfig, "sslVerify" | "sslCa" | "sslCert" | "sslKey" | "sshTunnel"> {
    const tunnel = tunnelPossible && form.sshEnabled;
    return {
      ...(tls
        ? {
            sslVerify: form.sslVerify,
            sslCa: form.sslCa.trim(),
            sslCert: form.sslCert.trim(),
            sslKey: (form.removeSslKey ? null : form.sslKey.trim()) as string | undefined,
          }
        : {}),
      sshTunnel: tunnel
        ? {
            host: form.sshHost.trim(),
            port: Number(form.sshPort) || 22,
            user: form.sshUser.trim(),
            password: (form.sshAuth === "password" ? form.sshPassword : null) as string | undefined,
            privateKey: (form.sshAuth === "key" ? form.sshPrivateKey.trim() : null) as string | undefined,
            passphrase: (form.sshAuth === "key" ? form.sshPassphrase : null) as string | undefined,
            hostKeyFingerprint: form.sshFingerprint.trim() || undefined,
          }
        : null,
    };
  }
</script>

<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import NumberInput from "@/components/ui/NumberInput.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import TextArea from "@/components/ui/TextArea.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * TLS beyond on/off — the authority the server's certificate is checked
   * against, a client certificate — and the SSH server the database is
   * reached through. Only for a connection made of a host and a port: a
   * connection string carries its own TLS settings, and a tunnel needs a host
   * and a port to forward to.
   */
  let {
    form = $bindable(),
    ssl = $bindable(),
    available,
  }: {
    form: SecurityForm;
    ssl: boolean;
    /** A network engine reached by host and port. */
    available: boolean;
  } = $props();

  const { t } = useTranslation();
  const LABEL = "mb-1 block text-xs font-medium text-text-muted";
  const uid = $props.id();

  /** A certificate or a key from a file, rather than pasted. */
  async function load(event: Event, apply: (text: string) => void) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) apply(await file.text());
    input.value = "";
  }
</script>

{#snippet pem(id: string, label: string, value: string, apply: (text: string) => void, placeholder: string)}
  <div>
    <div class="flex items-center justify-between">
      <label class={LABEL} for={id}>{label}</label>
      <label class="cursor-pointer text-[11px] text-accent hover:underline">
        {t("connections.security.loadFile")}
        <input type="file" class="hidden" accept=".pem,.crt,.cer,.key,.txt,*/*" onchange={(e) => void load(e, apply)} />
      </label>
    </div>
    <TextArea
      {id}
      variant="code"
      rows={3}
      class="w-full text-[11px]"
      {value}
      oninput={(e) => apply((e.currentTarget as HTMLTextAreaElement).value)}
      {placeholder}
      spellcheck={false}
    />
  </div>
{/snippet}

{#if !available}
  <Hint>{t("connections.security.unavailable")}</Hint>
{:else}
  <section class="space-y-3" aria-labelledby={`${uid}-tls`}>
    <h3 id={`${uid}-tls`} class="m-0 text-xs font-semibold">{t("connections.security.tlsTitle")}</h3>
    <Checkbox bind:checked={ssl}><span class="text-xs">{t("connections.sslEnable")}</span></Checkbox>
    {#if ssl}
      <Checkbox bind:checked={form.sslVerify} hint={t("connections.security.verifyHint")}>
        <span class="text-xs">{t("connections.security.verify")}</span>
      </Checkbox>
      {@render pem(
        `${uid}-ca`,
        t("connections.security.ca"),
        form.sslCa,
        (text) => {
          form.sslCa = text;
          // An authority of its own is pointless unless the certificate is checked against it.
          if (text.trim()) form.sslVerify = true;
        },
        "-----BEGIN CERTIFICATE-----",
      )}
      <div class="grid grid-cols-2 gap-2">
        {@render pem(
          `${uid}-cert`,
          t("connections.security.clientCert"),
          form.sslCert,
          (text) => (form.sslCert = text),
          "-----BEGIN CERTIFICATE-----",
        )}
        <div>
          {@render pem(
            `${uid}-key`,
            t("connections.security.clientKey"),
            form.sslKey,
            (text) => {
              form.sslKey = text;
              form.removeSslKey = false;
            },
            form.hasSslKey && !form.removeSslKey ? t("connections.security.keyStored") : "-----BEGIN PRIVATE KEY-----",
          )}
          {#if form.hasSslKey && !form.removeSslKey && !form.sslKey}
            <Button size="xs" variant="ghost" class="mt-1" onclick={() => (form.removeSslKey = true)}>
              {t("connections.security.removeKey")}
            </Button>
          {/if}
        </div>
      </div>
      <Hint>{t("connections.security.clientHint")}</Hint>
    {/if}
  </section>

  <section class="space-y-3 border-t border-border pt-3" aria-labelledby={`${uid}-ssh`}>
    <h3 id={`${uid}-ssh`} class="m-0 text-xs font-semibold">{t("connections.security.sshTitle")}</h3>
    <Checkbox bind:checked={form.sshEnabled} hint={t("connections.security.sshHint")}>
      <span class="text-xs">{t("connections.security.sshEnable")}</span>
    </Checkbox>
    {#if form.sshEnabled}
      <div class="grid grid-cols-3 gap-2">
        <div>
          <label class={LABEL} for={`${uid}-ssh-host`}>{t("connections.security.sshHost")}</label>
          <input id={`${uid}-ssh-host`} class={`${INPUT_CLASS} w-full`} bind:value={form.sshHost} placeholder="bastion.example.com" />
        </div>
        <div>
          <div class={LABEL} id={`${uid}-ssh-port`}>{t("connections.port")}</div>
          <NumberInput
            class="w-full"
            aria-labelledby={`${uid}-ssh-port`}
            value={form.sshPort || null}
            onChange={(value) => (form.sshPort = value ?? 22)}
          />
        </div>
        <div>
          <label class={LABEL} for={`${uid}-ssh-user`}>{t("connections.security.sshUser")}</label>
          <input id={`${uid}-ssh-user`} class={`${INPUT_CLASS} w-full`} bind:value={form.sshUser} autocomplete="off" />
        </div>
      </div>
      <SegmentedControl
        size="sm"
        aria-label={t("connections.security.sshAuth")}
        bind:value={form.sshAuth}
        options={[
          { value: "password", label: t("connections.security.sshPassword") },
          { value: "key", label: t("connections.security.sshKey") },
        ]}
      />
      {#if form.sshAuth === "password"}
        <div>
          <label class={LABEL} for={`${uid}-ssh-password`}>{t("connections.security.sshPassword")}</label>
          <input
            id={`${uid}-ssh-password`}
            type="password"
            class={`${INPUT_CLASS} w-full`}
            bind:value={form.sshPassword}
            autocomplete="new-password"
            placeholder={form.sshHasPassword ? "••••••••" : ""}
          />
        </div>
      {:else}
        {@render pem(
          `${uid}-ssh-key`,
          t("connections.security.sshKey"),
          form.sshPrivateKey,
          (text) => (form.sshPrivateKey = text),
          form.sshHasPrivateKey ? t("connections.security.keyStored") : "-----BEGIN OPENSSH PRIVATE KEY-----",
        )}
        <div>
          <label class={LABEL} for={`${uid}-ssh-passphrase`}>{t("connections.security.sshPassphrase")}</label>
          <input
            id={`${uid}-ssh-passphrase`}
            type="password"
            class={`${INPUT_CLASS} w-full`}
            bind:value={form.sshPassphrase}
            autocomplete="new-password"
          />
        </div>
      {/if}
      <div>
        <label class={LABEL} for={`${uid}-ssh-fingerprint`}>{t("connections.security.sshFingerprint")}</label>
        <input
          id={`${uid}-ssh-fingerprint`}
          class={`${INPUT_CLASS} w-full font-mono`}
          bind:value={form.sshFingerprint}
          placeholder="SHA256:…"
          spellcheck={false}
        />
        <Hint>{t("connections.security.sshFingerprintHint")}</Hint>
      </div>
    {/if}
  </section>
{/if}
