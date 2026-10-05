<script lang="ts">
  import type { DatabaseConnectionSummary, DatabaseEngine } from "@athanordb/shared";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import {
    deletePersonalConnection,
    fetchMyConnections,
    savePersonalConnection,
  } from "@/services/personalConnectionsApi";
  import ConnectionFormFields, { DEFAULT_PORTS } from "@/features/connections/ConnectionFormFields.svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  const { t } = useTranslation();
  const connections = useAsyncResource(fetchMyConnections);
  let editing = $state(false);
  let id = $state<string | undefined>();
  let name = $state("");
  let engine = $state<DatabaseEngine>("postgres");
  let host = $state("localhost");
  let port = $state(5432);
  let database = $state("");
  let user = $state("");
  let password = $state("");
  let ssl = $state(false);
  let environmentId = $state("");
  let connectionString = $state("");
  let filePath = $state("");
  let useUri = $state(false);
  let deleting = $state<DatabaseConnectionSummary | null>(null);
  function open(connection?: DatabaseConnectionSummary) {
    id = connection?.id;
    name = connection?.name ?? "";
    engine = connection?.engine ?? "postgres";
    host = connection?.host ?? "localhost";
    port = connection?.port ?? DEFAULT_PORTS[engine];
    database = connection?.database ?? "";
    user = connection?.user ?? "";
    password = "";
    ssl = connection?.ssl ?? false;
    connectionString = connection?.connectionString ?? "";
    filePath = connection?.filePath ?? "";
    useUri = Boolean(connectionString);
    editing = true;
  }
  const save = useAsyncAction(async () => {
    await savePersonalConnection(
      {
        name,
        engine,
        host: !useUri ? host : undefined,
        port: !useUri ? port : undefined,
        database: !useUri ? database : undefined,
        user: !useUri ? user : undefined,
        password: password || undefined,
        ssl,
        connectionString: useUri ? connectionString : "",
        filePath,
      },
      id,
    );
    editing = false;
    connections.reload();
  });
  const remove = useAsyncAction(async () => {
    if (!deleting) return;
    await deletePersonalConnection(deleting.id);
    deleting = null;
    connections.reload();
  });
</script>

<section class="border-t border-border pt-6">
  <h3 class="mb-1 text-sm font-semibold">{t("personalConnections.title")}</h3>
  <p class="mb-4 text-xs text-text-muted">{t("personalConnections.hint")}</p>
  <Button size="sm" onclick={() => open()}>{t("personalConnections.add")}</Button>
  {#if connections.error ?? remove.error}<ErrorText>{connections.error ?? remove.error}</ErrorText>{/if}
  <div class="mt-3 space-y-2">
    {#each connections.data?.personal ?? [] as connection (connection.id)}
      <div class="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
        <span class="min-w-0 flex-1 truncate text-sm">{connection.name}</span>
        <Button size="sm" onclick={() => open(connection)}>{t("common.edit")}</Button>
        <Button size="sm" variant="ghost" onclick={() => (deleting = connection)}>{t("common.delete")}</Button>
      </div>
    {/each}
  </div>
</section>
{#if editing}
  <Modal title={t("personalConnections.title")} onClose={() => (editing = false)} dismissable={!save.pending}>
    <label class="mb-4 block text-xs"
      >{t("common.name")}<input class={`${INPUT_CLASS} mt-1 w-full`} bind:value={name} /></label
    >
    <ConnectionFormFields
      bind:engine
      bind:host
      bind:port
      bind:database
      bind:user
      bind:password
      bind:ssl
      bind:environmentId
      bind:connectionString
      bind:filePath
      bind:useUri
      showEnvironment={false}
      passwordPlaceholder={id ? "••••••••" : ""}
    />
    {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
    <div class="mt-5 flex justify-end gap-2">
      <Button onclick={() => (editing = false)} disabled={save.pending}>{t("common.cancel")}</Button><Button
        variant="primary"
        onclick={() => void save.run()}
        disabled={!name.trim() || save.pending}>{t("common.save")}</Button
      >
    </div>
  </Modal>
{/if}
{#if deleting}
  <ConfirmDialog
    title={t("common.delete")}
    message={t("personalConnections.delete", { name: deleting.name })}
    pending={remove.pending}
    error={remove.error}
    danger="warning"
    onCancel={() => (deleting = null)}
    onConfirm={() => void remove.run()}
  />
{/if}
