<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import type { BackupDestination, BackupDestinationInput, BackupDestinationKind } from "@nebuladb/shared";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import NumberInput from "@/components/ui/NumberInput.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { saveBackupDestination } from "@/services/backupsApi";

  /**
   * "Emplacement": where this database's backups are written — a folder of the
   * server (local, or a mounted network share), an S3-compatible bucket or an
   * SFTP server. The server writes a file there, reads it back and deletes it
   * before keeping anything, so a destination that cannot work is refused here
   * rather than at the next backup. Credentials are never sent back: a saved
   * one is kept while its field is left empty.
   */
  let {
    connectionId,
    destination,
    onSaved,
  }: {
    connectionId: string;
    destination: BackupDestination;
    onSaved: (destination: BackupDestination) => void;
  } = $props();

  const { t } = useTranslation();
  const LABEL = "mb-1 block text-text-muted";
  const uid = $props.id();

  let kind = $state<BackupDestinationKind>("local");
  let directory = $state("");
  let endpoint = $state("");
  let region = $state("");
  let bucket = $state("");
  let prefix = $state("");
  let pathStyle = $state(false);
  let accessKeyId = $state("");
  let secretAccessKey = $state("");
  let host = $state("");
  let port = $state(22);
  let username = $state("");
  let remoteDir = $state("");
  let hostKeyFingerprint = $state("");
  let authMethod = $state<"password" | "privateKey">("password");
  let password = $state("");
  let privateKey = $state("");
  let passphrase = $state("");
  let saved = $state(false);

  /** Fills the form from what the server says is saved (credentials excepted: they never come back). */
  function load(source: BackupDestination) {
    kind = source.kind;
    directory = source.directory ?? "";
    endpoint = source.s3?.endpoint ?? "";
    region = source.s3?.region ?? "";
    bucket = source.s3?.bucket ?? "";
    prefix = source.s3?.prefix ?? "";
    pathStyle = source.s3?.pathStyle ?? false;
    host = source.sftp?.host ?? "";
    port = source.sftp?.port ?? 22;
    username = source.sftp?.username ?? "";
    remoteDir = source.sftp?.remoteDir ?? "";
    hostKeyFingerprint = source.sftp?.hostKeyFingerprint ?? "";
    authMethod = source.sftp?.authMethod ?? "password";
    accessKeyId = secretAccessKey = password = privateKey = passphrase = "";
  }
  $effect(() => load(destination));

  const hasSavedCredentials = $derived(destination.kind === kind && destination.hasCredentials);

  function input(): BackupDestinationInput {
    if (kind === "s3") {
      return {
        kind,
        s3: {
          endpoint: endpoint.trim(),
          region: region.trim(),
          bucket: bucket.trim(),
          prefix: prefix.trim(),
          pathStyle,
          accessKeyId: accessKeyId.trim(),
          secretAccessKey,
        },
      };
    }
    if (kind === "sftp") {
      return {
        kind,
        sftp: {
          host: host.trim(),
          port,
          username: username.trim(),
          remoteDir: remoteDir.trim(),
          hostKeyFingerprint: hostKeyFingerprint.trim(),
          ...(authMethod === "password" ? { password } : { privateKey, passphrase }),
        },
      };
    }
    return { kind, directory: directory.trim() || null };
  }

  const save = useAsyncAction(async (body: BackupDestinationInput) => {
    saved = false;
    onSaved(await saveBackupDestination(connectionId, body));
    saved = true;
  });
  const touched = () => (saved = false);
</script>

<div class="mt-3 rounded-md border border-border bg-surface p-3 text-xs" data-testid="backup-destination">
  <div class="mb-1 font-semibold text-text">{t("backups.destination.title")}</div>
  <Hint>{t("backups.destination.hint")}</Hint>
  <div class="mt-2">
    <SegmentedControl
      size="sm"
      aria-label={t("backups.destination.kind")}
      bind:value={kind}
      onChange={touched}
      options={[
        { value: "local", label: t("backups.destination.kind.local") },
        { value: "s3", label: t("backups.destination.kind.s3") },
        { value: "sftp", label: t("backups.destination.kind.sftp") },
      ]}
    />
  </div>

  <div class="mt-2 space-y-2" oninput={touched} role="presentation">
    {#if kind === "local"}
      <Input inputSize="sm"
        class="w-full font-mono"
        aria-label={t("backups.destination.label")}
        placeholder={t("backups.destination.placeholder", { directory: destination.defaultDirectory })}
        bind:value={directory}
        disabled={save.pending}
      />
    {:else if kind === "s3"}
      <Hint>{t("backups.destination.s3Hint")}</Hint>
      <div class="grid grid-cols-2 gap-2">
        <div class="col-span-2">
          <label class={LABEL} for={`${uid}-endpoint`}>{t("backups.destination.s3.endpoint")}</label>
          <Input inputSize="sm"
            id={`${uid}-endpoint`}
            class="w-full font-mono"
            bind:value={endpoint}
            placeholder="https://minio.example.com:9000"
            spellcheck={false}
          />
        </div>
        <div>
          <label class={LABEL} for={`${uid}-bucket`}>{t("backups.destination.s3.bucket")}</label>
          <Input inputSize="sm" id={`${uid}-bucket`} class="w-full font-mono" bind:value={bucket} spellcheck={false} />
        </div>
        <div>
          <label class={LABEL} for={`${uid}-region`}>{t("backups.destination.s3.region")}</label>
          <Input inputSize="sm"
            id={`${uid}-region`}
            class="w-full font-mono"
            bind:value={region}
            placeholder="us-east-1"
            spellcheck={false}
          />
        </div>
        <div class="col-span-2">
          <label class={LABEL} for={`${uid}-prefix`}>{t("backups.destination.s3.prefix")}</label>
          <Input inputSize="sm"
            id={`${uid}-prefix`}
            class="w-full font-mono"
            bind:value={prefix}
            placeholder="nebula/backups"
            spellcheck={false}
          />
        </div>
        <div>
          <label class={LABEL} for={`${uid}-key`}>{t("backups.destination.s3.accessKeyId")}</label>
          <Input inputSize="sm"
            id={`${uid}-key`}
            class="w-full font-mono"
            bind:value={accessKeyId}
            autocomplete="off"
            placeholder={hasSavedCredentials ? "••••••••" : ""}
          />
        </div>
        <div>
          <label class={LABEL} for={`${uid}-secret`}>{t("backups.destination.s3.secretAccessKey")}</label>
          <Input inputSize="sm"
            id={`${uid}-secret`}
            type="password"
            class="w-full font-mono"
            bind:value={secretAccessKey}
            autocomplete="new-password"
            placeholder={hasSavedCredentials ? "••••••••" : ""}
          />
        </div>
      </div>
      <Checkbox bind:checked={pathStyle}>{t("backups.destination.s3.pathStyle")}</Checkbox>
      {#if hasSavedCredentials}<Hint>{t("backups.destination.keepCredentials")}</Hint>{/if}
    {:else}
      <Hint>{t("backups.destination.sftpHint")}</Hint>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class={LABEL} for={`${uid}-host`}>{t("backups.destination.sftp.host")}</label>
          <Input inputSize="sm" id={`${uid}-host`} class="w-full font-mono" bind:value={host} spellcheck={false} />
        </div>
        <div>
          <span class={LABEL}>{t("backups.destination.sftp.port")}</span>
          <NumberInput min={1} max={65535} value={port} onChange={(value) => (port = value ?? 22)} />
        </div>
        <div>
          <label class={LABEL} for={`${uid}-user`}>{t("backups.destination.sftp.username")}</label>
          <Input inputSize="sm"
            id={`${uid}-user`}
            class="w-full font-mono"
            bind:value={username}
            autocomplete="off"
          />
        </div>
        <div>
          <label class={LABEL} for={`${uid}-dir`}>{t("backups.destination.sftp.remoteDir")}</label>
          <Input inputSize="sm"
            id={`${uid}-dir`}
            class="w-full font-mono"
            bind:value={remoteDir}
            placeholder="/upload/nebula"
          />
        </div>
        <div class="col-span-2">
          <label class={LABEL} for={`${uid}-fp`}>{t("backups.destination.sftp.fingerprint")}</label>
          <Input inputSize="sm"
            id={`${uid}-fp`}
            class="w-full font-mono"
            bind:value={hostKeyFingerprint}
            placeholder="SHA256:…"
            spellcheck={false}
          />
          <Hint>{t("backups.destination.sftp.fingerprintHint")}</Hint>
        </div>
      </div>
      <SegmentedControl
        size="sm"
        aria-label={t("backups.destination.sftp.auth")}
        bind:value={authMethod}
        onChange={touched}
        options={[
          { value: "password", label: t("backups.destination.sftp.password") },
          { value: "privateKey", label: t("backups.destination.sftp.privateKey") },
        ]}
      />
      {#if authMethod === "password"}
        <Input inputSize="sm"
          type="password"
          class="w-full"
          aria-label={t("backups.destination.sftp.password")}
          bind:value={password}
          autocomplete="new-password"
          placeholder={hasSavedCredentials ? "••••••••" : ""}
        />
      {:else}
        <textarea
          class={`${INPUT_SM_CLASS} h-20 w-full font-mono`}
          aria-label={t("backups.destination.sftp.privateKey")}
          bind:value={privateKey}
          spellcheck={false}
          placeholder={hasSavedCredentials ? "••••••••" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
        ></textarea>
        <Input inputSize="sm"
          type="password"
          class="w-full"
          aria-label={t("backups.destination.sftp.passphrase")}
          placeholder={t("backups.destination.sftp.passphrase")}
          bind:value={passphrase}
          autocomplete="new-password"
        />
      {/if}
      {#if hasSavedCredentials}<Hint>{t("backups.destination.keepCredentials")}</Hint>{/if}
    {/if}
  </div>

  <div class="mt-2 flex flex-wrap items-center gap-2">
    <Button size="xs" variant="outline" disabled={save.pending} onclick={() => void save.run(input())}>
      {save.pending ? t("common.loading") : t("backups.destination.save")}
    </Button>
    {#if destination.kind !== "local" || destination.directory}
      <Button
        size="xs"
        variant="ghost"
        disabled={save.pending}
        onclick={() => void save.run({ kind: "local", directory: null })}
      >
        {t("backups.destination.reset")}
      </Button>
    {/if}
  </div>
  {#if saved}<Hint>{t("backups.destination.saved")}</Hint>{/if}
  {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
</div>
