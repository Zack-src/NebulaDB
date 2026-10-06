<script lang="ts">
  import type { DatabaseEngine } from "@nebuladb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import ConnectionFormFields from "@/features/connections/ConnectionFormFields.svelte";
  import { createProjectFromDatabase, type CreateProjectFromDatabaseResponse } from "@/services/connectionsApi";

  /**
   * "New Project from Database": the counterpart to Nebula's existing
   * project-to-database deploy flow. There is no project to attach a
   * connection to yet, so unlike the admin console's `ConnectionEditModal` this has no separate
   * "Test Connection" step against `/api/projects/:id/connections/test` (that
   * route needs a project id) — submitting *is* the test: the server creates
   * the project, saves the connection, and introspects the live schema into it
   * in one call, rolling all of it back if introspection fails (see
   * `createProjectFromDatabase` server-side), so a bad host/credentials never
   * leaves a stray empty project behind.
   */
  let {
    onClose,
    onCreated,
  }: {
    onClose: () => void;
    onCreated: (result: CreateProjectFromDatabaseResponse) => void;
  } = $props();

  const { t } = useTranslation();

  let name = $state("");
  let environmentId = $state("");
  let engine = $state<DatabaseEngine>("postgres");
  let host = $state("localhost");
  let port = $state(5432);
  let database = $state("");
  let user = $state("postgres");
  let password = $state("");
  let ssl = $state(false);
  let connectionString = $state("");
  let filePath = $state("./data/dev.sqlite");
  let useUri = $state(false);

  let creating = $state(false);
  let error = $state<string | null>(null);

  async function handleCreate() {
    creating = true;
    error = null;
    try {
      const connectionName = name.trim() || database.trim() || t("connections.newConnection");
      const remote = !(useUri || engine === "sqlite");
      const result = await createProjectFromDatabase(name, {
        name: connectionName,
        environmentId: environmentId || undefined,
        engine,
        host: remote ? host : undefined,
        port: remote ? Number(port) : undefined,
        database: remote ? database : undefined,
        user: remote ? user : undefined,
        password: password || undefined,
        ssl: remote ? ssl : undefined,
        connectionString: useUri && engine !== "sqlite" ? connectionString : undefined,
        filePath: engine === "sqlite" ? filePath : undefined,
      });
      onCreated(result);
    } catch (err) {
      error = describeApiError(err, t);
    } finally {
      creating = false;
    }
  }
</script>

<Modal title={t("projects.newFromDatabase")} {onClose} wide>
  <div class="space-y-4">
    <p class="text-xs text-text-muted">{t("projects.newFromDatabaseDesc")}</p>

    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="mb-1 block text-xs font-medium text-text-muted">{t("projects.projectName")}</label>
      <input class={INPUT_CLASS} bind:value={name} placeholder={t("projects.projectNamePlaceholder")} />
    </div>

    <ConnectionFormFields
      bind:environmentId
      bind:engine
      bind:host
      bind:port
      bind:database
      bind:user
      bind:password
      bind:ssl
      bind:connectionString
      bind:filePath
      bind:useUri
    />

    {#if error}<ErrorText>{error}</ErrorText>{/if}

    <div class="flex items-center justify-end gap-2 border-t border-border pt-4">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={creating}>{t("common.cancel")}</Button>
      <Button size="sm" variant="primary" onclick={handleCreate} disabled={creating}>
        {creating ? t("projects.creatingFromDatabase") : t("projects.createFromDatabase")}
      </Button>
    </div>
  </div>
</Modal>
