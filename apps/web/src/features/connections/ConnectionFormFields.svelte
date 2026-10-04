<script lang="ts" module>
  import type { DatabaseEngine } from "@athanordb/shared";

  export const DEFAULT_PORTS: Record<DatabaseEngine, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0,
    mssql: 1433,
    oracle: 1521,
  };

  const ENGINES: DatabaseEngine[] = ["postgres", "mysql", "mssql", "oracle", "sqlite"];
</script>

<script lang="ts">
  import type { EnvironmentStage } from "@athanordb/shared";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import NumberInput from "@/components/ui/NumberInput.svelte";
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
  } = $props();

  const { t } = useTranslation();
  const LABEL = "mb-1 block text-xs font-medium text-text-muted";

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

  <div class="col-span-2">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label id="connection-environment" class={LABEL}>{t("connections.environment")}</label>
    <Select
      aria-labelledby="connection-environment"
      value={environmentId}
      options={stageOptions}
      onChange={(value) => (environmentId = value)}
    />
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
    <Checkbox bind:checked={useUri}><span class="text-xs">{t("connections.useUri")}</span></Checkbox>
  </div>

  {#if useUri}
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={LABEL}>{t("connections.connectionUri")}</label>
      <input class={INPUT_CLASS} type="password" bind:value={connectionString} placeholder={uriPlaceholder} />
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

      <div class="grid grid-cols-3 gap-2">
        <div class="col-span-1">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class={LABEL}>{engine === "oracle" ? t("connections.oracleService") : t("connections.database")}</label>
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
          <input class={INPUT_CLASS} type="password" bind:value={password} placeholder={passwordPlaceholder} />
        </div>
      </div>

      <div>
        <Checkbox bind:checked={ssl}><span class="text-xs">{t("connections.sslEnable")}</span></Checkbox>
      </div>
    </div>
  {/if}
{/if}
