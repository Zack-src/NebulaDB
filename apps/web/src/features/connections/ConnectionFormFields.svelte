<script lang="ts" module>
  import type { DatabaseEngine } from "@athanordb/shared";

  export const DEFAULT_PORTS: Record<DatabaseEngine, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0,
    mssql: 1433,
    oracle: 1521,
  };
</script>

<script lang="ts">
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The connection-config form fields, shared by the admin console's
   * `ConnectionEditModal` and `NewProjectFromDatabaseModal`
   * (entering one before a project even exists) — extracted so the two don't
   * drift out of sync on engine support, field layout, or validation as either
   * one changes.
   */
  let {
    environment = $bindable(),
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
    environment: string;
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
    <label class={LABEL}>{t("connections.engine")}</label>
    <select
      class={SELECT_CLASS}
      value={engine}
      onchange={(e) => handleEngineChange(e.currentTarget.value as DatabaseEngine)}
    >
      <option value="postgres">{t("connections.engine.postgres")}</option>
      <option value="mysql">{t("connections.engine.mysql")}</option>
      <option value="mssql">{t("connections.engine.mssql")}</option>
      <option value="oracle">{t("connections.engine.oracle")}</option>
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
          <label class={LABEL}>{t("connections.port")}</label>
          <input class={INPUT_CLASS} type="number" bind:value={port} />
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
        <label class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text">
          <input type="checkbox" bind:checked={ssl} class="rounded border-border" />
          {t("connections.sslEnable")}
        </label>
      </div>
    </div>
  {/if}
{/if}
