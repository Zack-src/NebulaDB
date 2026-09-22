<script lang="ts" module>
  import type { DatabaseEngine } from "@athanordb/shared";

  const DEFAULT_PORTS: Record<DatabaseEngine, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0,
    // Not yet offered in this modal's engine picker below (postgres/mysql/sqlite only) —
    // the backend supports these two (`apps/server/.../drivers/{mssql,oracle}.ts`), but
    // wiring them into this UI (dropdown option, badge tone, host/port field visibility)
    // is a separate piece of work from what added these constants.
    mssql: 1433,
    oracle: 1521,
  };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { DatabaseConnectionConfig, DatabaseConnectionSummary } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckCircleIcon, CheckIcon, DatabaseIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import { INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    createProjectConnection,
    deleteProjectConnection,
    listProjectConnections,
    pullDatabaseSchema,
    testConnectionConfig,
    updateProjectConnection,
  } from "@/services/connectionsApi";

  let {
    projectId,
    onClose,
    onSelectActiveConnection,
  }: {
    projectId: string;
    onClose: () => void;
    onSelectActiveConnection?: (conn: DatabaseConnectionSummary) => void;
  } = $props();

  const { t } = useTranslation();
  let connections = $state.raw<DatabaseConnectionSummary[]>([]);
  let loading = $state(true);
  let selectedId = $state<string | "new">("new");
  let error = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  // Form state
  let name = $state("");
  let environment = $state("");
  let engine = $state<DatabaseEngine>("postgres");
  let host = $state("localhost");
  let port = $state(5432);
  let database = $state("");
  let user = $state("postgres");
  let password = $state("");
  let ssl = $state(false);
  let connectionString = $state("");
  let filePath = $state("");
  let useUri = $state(false);

  let testing = $state(false);
  let testResult = $state.raw<{ ok: boolean; message: string } | null>(null);
  let saving = $state(false);
  let pulling = $state(false);

  function selectConnection(conn: DatabaseConnectionSummary) {
    selectedId = conn.id;
    name = conn.name;
    environment = conn.environment || "";
    engine = conn.engine;
    host = conn.host || "localhost";
    port = conn.port || DEFAULT_PORTS[conn.engine] || 5432;
    database = conn.database || "";
    user = conn.user || "";
    password = "";
    ssl = Boolean(conn.ssl);
    connectionString = conn.connectionString || "";
    filePath = conn.filePath || "";
    useUri = Boolean(conn.connectionString);
    testResult = null;
    error = null;
    successMessage = null;
  }

  /** Reusable for the manual reload after a save/delete; the mount fetch below is a separate inline chain. */
  async function load() {
    try {
      loading = true;
      const list = await listProjectConnections(projectId);
      connections = list;
      if (list.length > 0 && selectedId === "new") selectConnection(list[0]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const id = projectId;
    let active = true;
    loading = true;
    listProjectConnections(id)
      .then((list) => {
        if (!active) return;
        connections = list;
        if (list.length > 0 && untrack(() => selectedId) === "new") selectConnection(list[0]);
      })
      .catch((err: unknown) => {
        if (active) error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });

  function handleNew() {
    selectedId = "new";
    name = "Dev Database";
    environment = "";
    engine = "postgres";
    host = "localhost";
    port = 5432;
    database = "my_database";
    user = "postgres";
    password = "";
    ssl = false;
    connectionString = "";
    filePath = "./data/dev.sqlite";
    useUri = false;
    testResult = null;
    error = null;
    successMessage = null;
  }

  function handleEngineChange(nextEngine: DatabaseEngine) {
    engine = nextEngine;
    port = DEFAULT_PORTS[nextEngine] || 5432;
    if (nextEngine === "sqlite") {
      filePath = filePath || "./data/database.sqlite";
    }
  }

  function getFormPayload(): DatabaseConnectionConfig {
    return {
      id: selectedId === "new" ? "" : selectedId,
      projectId,
      name: name.trim() || "Database",
      environment: environment.trim() || undefined,
      engine,
      host: useUri || engine === "sqlite" ? undefined : host,
      port: useUri || engine === "sqlite" ? undefined : Number(port),
      database: useUri || engine === "sqlite" ? undefined : database,
      user: useUri || engine === "sqlite" ? undefined : user,
      password: password || undefined,
      ssl: useUri || engine === "sqlite" ? undefined : ssl,
      connectionString: useUri && engine !== "sqlite" ? connectionString : undefined,
      filePath: engine === "sqlite" ? filePath : undefined,
    };
  }

  async function handleTest() {
    testing = true;
    testResult = null;
    error = null;
    try {
      const res = await testConnectionConfig(projectId, getFormPayload());
      if (res.ok) {
        testResult = {
          ok: true,
          message: `${t("connections.testSuccess")}: ${res.version ?? ""} ${res.database ? `(${res.database})` : ""}`,
        };
      } else {
        testResult = { ok: false, message: res.error || t("connections.testFailed") };
      }
    } catch (err) {
      testResult = { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      testing = false;
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      error = t("errors.nameRequired");
      return;
    }
    saving = true;
    error = null;
    try {
      const payload = getFormPayload();
      const saved =
        selectedId === "new"
          ? await createProjectConnection(projectId, payload)
          : await updateProjectConnection(projectId, selectedId, payload);
      successMessage = t("common.saved");
      await load();
      selectConnection(saved);
      onSelectActiveConnection?.(saved);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("connections.confirmDelete"))) return;
    try {
      await deleteProjectConnection(projectId, id);
      const list = await listProjectConnections(projectId);
      connections = list;
      if (list.length > 0) selectConnection(list[0]);
      else handleNew();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handlePullSchema() {
    if (selectedId === "new") return;
    if (!window.confirm(t("connections.confirmPull"))) return;
    pulling = true;
    error = null;
    try {
      const res = await pullDatabaseSchema(projectId, selectedId);
      successMessage = t("connections.pulledSuccess", { count: res.tablesCount });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      pulling = false;
    }
  }

  const LABEL = "mb-1 block text-xs font-medium text-text-muted";
</script>

<Modal title={t("connections.title")} {onClose} wide>
  <div class="grid grid-cols-1 gap-6 md:grid-cols-12">
    <!-- Sidebar: list of connections -->
    <div class="space-y-2 md:col-span-4 md:border-r md:border-border md:pr-4">
      <div class="flex items-center justify-between pb-1">
        <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t("connections.savedConnections")}
        </span>
        <Button size="xs" variant="ghost" onclick={handleNew}>
          <Icon icon={PlusIcon} size={12} />
          {t("common.add")}
        </Button>
      </div>

      <div class="max-h-80 space-y-1 overflow-y-auto">
        {#each connections as c (c.id)}
          {@const active = c.id === selectedId}
          <button
            type="button"
            onclick={() => selectConnection(c)}
            class={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-left text-xs transition-colors ${
              active ? "bg-accent/15 font-semibold text-accent" : "text-text hover:bg-surface-hover"
            }`}
          >
            <div class="flex min-w-0 items-center gap-2">
              <Icon icon={DatabaseIcon} size={13} class="shrink-0 text-text-muted" />
              <span class="truncate">{c.name}</span>
              {#if c.environment}
                <span class="shrink-0 truncate text-[10px] text-text-muted">({c.environment})</span>
              {/if}
            </div>
            <Badge tone={c.engine === "postgres" ? "admin" : c.engine === "mysql" ? "warning" : "muted"}>{c.engine}</Badge>
          </button>
        {/each}

        {#if connections.length === 0 && !loading}
          <p class="py-4 text-center text-xs text-text-muted">{t("connections.noConnections")}</p>
        {/if}
      </div>
    </div>

    <!-- Right pane: form configuration -->
    <div class="space-y-4 md:col-span-8">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-text">
          {selectedId === "new" ? t("connections.newConnection") : t("connections.editConnection")}
        </h3>
        {#if selectedId !== "new"}
          <div class="flex items-center gap-1.5">
            <Button size="xs" variant="danger" onclick={() => handleDelete(selectedId)}>
              <Icon icon={TrashIcon} size={12} />
              {t("common.delete")}
            </Button>
          </div>
        {/if}
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2 sm:col-span-1">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class={LABEL}>{t("common.name")}</label>
          <input class={INPUT_CLASS} bind:value={name} placeholder="ex: Production DB" />
        </div>

        <div class="col-span-2 sm:col-span-1">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class={LABEL}>{t("connections.engine")}</label>
          <select
            class={SELECT_CLASS}
            value={engine}
            onchange={(e) => handleEngineChange(e.currentTarget.value as DatabaseEngine)}
          >
            <option value="postgres">{t("connections.engine.postgres")}</option>
            <option value="mysql">{t("connections.engine.mysql")}</option>
            <option value="sqlite">{t("connections.engine.sqlite")}</option>
          </select>
        </div>

        <div class="col-span-2">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class={LABEL}>{t("connections.environment")}</label>
          <input class={INPUT_CLASS} bind:value={environment} placeholder={t("connections.environmentPlaceholder")} />
          <Hint>{t("connections.environmentHint")}</Hint>
        </div>
      </div>

      {#if engine === "sqlite"}
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class={LABEL}>{t("connections.filePath")}</label>
          <input class={INPUT_CLASS} bind:value={filePath} placeholder="./data/app.sqlite" />
          <Hint>{t("connections.sqliteHint")}</Hint>
        </div>
      {:else}
        <div class="flex items-center gap-2 pt-1">
          <label class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text">
            <input type="checkbox" bind:checked={useUri} class="rounded border-border" />
            {t("connections.useUri")}
          </label>
        </div>

        {#if useUri}
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class={LABEL}>{t("connections.connectionUri")}</label>
            <input
              class={INPUT_CLASS}
              type="password"
              bind:value={connectionString}
              placeholder={engine === "postgres"
                ? "postgres://user:pass@host:5432/dbname"
                : "mysql://user:pass@host:3306/dbname"}
            />
          </div>
        {:else}
          <div class="space-y-3">
            <div class="grid grid-cols-3 gap-2">
              <div class="col-span-2">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class={LABEL}>{t("connections.host")}</label>
                <input class={INPUT_CLASS} bind:value={host} />
              </div>
              <div>
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class={LABEL}>{t("connections.port")}</label>
                <input class={INPUT_CLASS} type="number" bind:value={port} />
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <div class="col-span-1">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class={LABEL}>{t("connections.database")}</label>
                <input class={INPUT_CLASS} bind:value={database} />
              </div>
              <div class="col-span-1">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class={LABEL}>{t("connections.user")}</label>
                <input class={INPUT_CLASS} bind:value={user} />
              </div>
              <div class="col-span-1">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class={LABEL}>{t("connections.password")}</label>
                <input
                  class={INPUT_CLASS}
                  type="password"
                  bind:value={password}
                  placeholder={selectedId !== "new" ? "••••••••" : ""}
                />
              </div>
            </div>

            <div>
              <label class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text">
                <input type="checkbox" bind:checked={ssl} class="rounded border-border" />
                {t("connections.sslEnable")}
              </label>
            </div>
          </div>
        {/if}
      {/if}

      {#if testResult}
        <div
          class={`flex items-center gap-2 rounded-sm border p-2 text-xs ${
            testResult.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-rose-500/30 bg-rose-500/10 text-rose-400"
          }`}
        >
          {#if testResult.ok}<Icon icon={CheckCircleIcon} size={14} />{/if}
          <span>{testResult.message}</span>
        </div>
      {/if}

      {#if successMessage}<Hint>{successMessage}</Hint>{/if}
      {#if error}<ErrorText>{error}</ErrorText>{/if}

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div class="flex items-center gap-2">
          <Button size="sm" variant="ghost" onclick={handleTest} disabled={testing}>
            {testing ? t("common.loading") : t("connections.testConnection")}
          </Button>
          {#if selectedId !== "new"}
            <Button size="sm" variant="ghost" onclick={handlePullSchema} disabled={pulling}>
              {pulling ? t("common.loading") : t("connections.pullSchema")}
            </Button>
          {/if}
        </div>

        <div class="flex items-center gap-2">
          <Button size="sm" variant="ghost" onclick={onClose}>{t("common.close")}</Button>
          <Button size="sm" variant="primary" onclick={handleSave} disabled={saving}>
            <Icon icon={CheckIcon} size={13} />
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  </div>
</Modal>
