<script lang="ts" module>
  import type { DatabaseEngine } from "@nebuladb/shared";

  export const DEFAULT_PORTS: Record<DatabaseEngine, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0,
    mssql: 1433,
    oracle: 1521,
    bigquery: 0,
  };

  const ENGINES: DatabaseEngine[] = ["postgres", "mysql", "mssql", "oracle", "sqlite", "bigquery"];
</script>

<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import type { Snippet } from "svelte";
  import type { EnvironmentStage } from "@nebuladb/shared";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Hint from "@/components/ui/Hint.svelte";
    import NumberInput from "@/components/ui/NumberInput.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchEnvironments } from "@/services/environmentsApi";

  /**
   * The connection-config form fields, shared by the admin console's
   * `ConnectionEditModal` and `NewProjectFromDatabaseModal`
   * (entering one before a project even exists) — extracted so the two don't
   * drift out of sync on engine support, field layout, or validation as either
   * one changes.
   */
  let {
    environmentId = $bindable(),
    engine = $bindable(),
    host = $bindable(),
    port = $bindable(),
    database = $bindable(),
    user = $bindable(),
    password = $bindable(),
    passwordPlaceholder = "",
    ssl = $bindable(),
    connectionString = $bindable(),
    filePath = $bindable(),
    useUri = $bindable(),
    showCredentials = true,
    showEnvironment = true,
    showSsl = true,
    beforeDetails,
  }: {
    /** The deployment stage (Admin → Environnements); `""` for none. */
    environmentId: string;
    engine: DatabaseEngine;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    passwordPlaceholder?: string;
    ssl: boolean;
    connectionString: string;
    filePath: string;
    useUri: boolean;
    showCredentials?: boolean;
    showEnvironment?: boolean;
    /** `false` where TLS has a tab of its own (the admin console's Sécurité tab). */
    showSsl?: boolean;
    /** Rendered between the engine and the connection details: the admin console puts the account choice there. */
    beforeDetails?: Snippet;
  } = $props();

  const { t } = useTranslation();
  const LABEL = "mb-1.5 block text-xs font-medium text-text-muted";

  let stages = $state.raw<EnvironmentStage[]>([]);
  $effect(() => {
    fetchEnvironments()
      .then((loaded) => (stages = loaded))
      // Without the list the field only offers "none"; the server still checks whatever is sent.
      .catch(() => {});
  });
  const stageOptions = $derived([
    { value: "", label: t("connections.environmentNone") },
    ...stages.map((stage) => ({
      value: stage.id,
      label: stage.name,
      hint: stage.production ? t("environments.production") : undefined,
    })),
  ]);

  function handleEngineChange(nextEngine: DatabaseEngine) {
    engine = nextEngine;
    port = DEFAULT_PORTS[nextEngine] || 5432;
    if (nextEngine === "sqlite" && !filePath) filePath = "./data/database.sqlite";
    // A BigQuery connection is a project and a dataset: there is no address to give as a URI, and no port.
    if (nextEngine === "bigquery") {
      useUri = false;
      port = 0;
    }
  }

  const uriPlaceholder = $derived(
    engine === "postgres"
      ? "postgres://user:pass@host:5432/dbname"
      : engine === "mssql"
        ? "Server=host,1433;Database=dbname;User Id=user;Password=pass;Encrypt=true"
        : engine === "oracle"
          ? "host:1521/service_name"
          : "mysql://user:pass@host:3306/dbname",
  );
</script>

<div class="grid grid-cols-2 gap-3">
  <div class="col-span-2 sm:col-span-1">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label id="connection-engine" class={LABEL}>{t("connections.engine")}</label>
    <Select
      class="w-full"
      aria-labelledby="connection-engine"
      value={engine}
      options={ENGINES.map((value) => ({ value, label: t(`connections.engine.${value}`) }))}
      onChange={handleEngineChange}
    />
  </div>

  {#if showEnvironment}
    <div class="col-span-2 sm:col-span-1">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label id="connection-environment" class={LABEL}>{t("connections.environment")}</label>
      <Select
        class="w-full"
        aria-labelledby="connection-environment"
        value={environmentId}
        options={stageOptions}
        onChange={(value) => (environmentId = value)}
      />
    </div>
    <div class="col-span-2 -mt-1.5"><Hint>{t("connections.environmentHint")}</Hint></div>
  {/if}
</div>

{@render beforeDetails?.()}

{#if engine === "sqlite"}
  <div>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class={LABEL}>{t("connections.filePath")}</label>
    <Input class="w-full" bind:value={filePath} placeholder="./data/app.sqlite" />
    <Hint>{t("connections.sqliteHint")}</Hint>
  </div>
{:else if engine === "bigquery"}
  <!-- The same fields as any other engine underneath: the project is the host, the dataset the database, the key the password. -->
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-3">
      <div>
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class={LABEL}>{t("connections.bigqueryProject")}</label>
        <Input class="w-full" bind:value={host} placeholder="my-gcp-project" />
      </div>
      <div>
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class={LABEL}>{t("connections.bigqueryDataset")}</label>
        <Input class="w-full" bind:value={database} placeholder="my_dataset" />
      </div>
    </div>
    {#if showCredentials}<div>
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class={LABEL}>{t("connections.bigqueryKey")}</label>
        <Input class="w-full" type="password" bind:value={password} placeholder={passwordPlaceholder} />
        <Hint>{t("connections.bigqueryHint")}</Hint>
      </div>{/if}
  </div>
{:else}
  <div>
    <div id="connection-address-mode" class={LABEL}>{t("connections.addressMode")}</div>
    <SegmentedControl
      size="sm"
      aria-labelledby="connection-address-mode"
      value={useUri ? "uri" : "host"}
      onChange={(mode) => (useUri = mode === "uri")}
      options={[
        { value: "host", label: t("connections.addressHost") },
        { value: "uri", label: t("connections.addressUri") },
      ]}
    />
  </div>

  {#if useUri}
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={LABEL}>{t("connections.connectionUri")}</label>
      <Input class="w-full" type="password" bind:value={connectionString} placeholder={uriPlaceholder} />
    </div>
  {:else}
    <div class="space-y-3">
      <div class="grid grid-cols-4 gap-3">
        <div class="col-span-3">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class={LABEL}>{t("connections.host")}</label>
          <Input class="w-full" bind:value={host} />
        </div>
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label id="connection-port" class={LABEL}>{t("connections.port")}</label>
          <!-- 0 is no port at all: it stands for the field left empty. -->
          <NumberInput
            class="w-full"
            aria-labelledby="connection-port"
            value={port || null}
            onChange={(value) => (port = value ?? 0)}
          />
        </div>
      </div>

      <div class={`grid gap-3 ${showCredentials ? "grid-cols-3" : "grid-cols-1"}`}>
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class={LABEL}>{engine === "oracle" ? t("connections.oracleService") : t("connections.database")}</label
          >
          <Input class="w-full" bind:value={database} />
        </div>
        {#if showCredentials}
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class={LABEL}>{t("connections.user")}</label>
            <Input class="w-full" bind:value={user} autocomplete="off" />
          </div>
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class={LABEL}>{t("connections.password")}</label>
            <Input
              class="w-full"
              type="password"
              bind:value={password}
              placeholder={passwordPlaceholder}
              autocomplete="new-password"
            />
          </div>
        {/if}
      </div>

      {#if showSsl}<div>
          <Checkbox bind:checked={ssl}><span class="text-xs">{t("connections.sslEnable")}</span></Checkbox>
        </div>{/if}
    </div>
  {/if}
{/if}
