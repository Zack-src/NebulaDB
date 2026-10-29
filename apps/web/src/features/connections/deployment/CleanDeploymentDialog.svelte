<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { ApiError } from "@/services/ApiError";
  import { applyDeployment, previewCleanDeployment } from "@/services/connectionsApi";
  import DeploymentFailureBlock from "./DeploymentFailureBlock.svelte";
  import { parseDeploymentFailure, type DeploymentFailure } from "./deploymentFailure";

  /**
   * "Start over": drop the database's tables and write the schema again. Shows what would go and what would come
   * back, asks for the connection's name, and runs the deployment with the `clean` option. The server decides who
   * may (project administrators) and where (not production, not a stage that asks for a review).
   */
  let {
    projectId,
    connId,
    connectionName,
    onClose,
    onDone,
    onShowInGraph,
    onShowInCode,
    tableExists,
  }: {
    projectId: string;
    connId: string;
    connectionName: string;
    onClose: () => void;
    /** The database was rebuilt: the analysis behind the panel is stale. */
    onDone: () => void;
    onShowInGraph?: (tableName: string, fieldName?: string) => void;
    onShowInCode?: (tableName: string) => void;
    tableExists?: (tableName: string) => boolean;
  } = $props();

  const { t } = useTranslation();
  let includeUnmanaged = $state(false);
  let backupBefore = $state(true);
  let typed = $state("");
  let running = $state(false);
  let error = $state<string | null>(null);
  let failure = $state.raw<DeploymentFailure | null>(null);

  const preview = useAsyncResource(() => previewCleanDeployment(projectId, connId, includeUnmanaged));
  // A fixed word, not the connection's name: the name may differ in case or spacing from one machine to the next.
  const confirmWord = $derived(t("deployment.clean.confirmWord"));
  const confirmed = $derived(typed.trim().toUpperCase() === confirmWord.toUpperCase());
  const ready = $derived(preview.data !== null && !preview.loading && !preview.error);

  async function run() {
    running = true;
    error = null;
    failure = null;
    try {
      await applyDeployment(projectId, connId, {}, { clean: { includeUnmanaged }, confirmName: connectionName, backupBefore });
      onDone();
      onClose();
    } catch (err) {
      error = describeApiError(err, t);
      failure = err instanceof ApiError && err.code === "MIGRATION_FAILED" ? parseDeploymentFailure(err.details) : null;
    } finally {
      running = false;
    }
  }
</script>

<Modal title={t("deployment.clean.title")} {onClose}>
  <div class="space-y-3">
    <div class="flex items-start gap-2 rounded-sm border border-danger bg-danger-light p-2.5 text-xs text-danger">
      <Icon icon={AlertTriangleIcon} size={14} class="mt-px shrink-0" />
      <span>{t("deployment.clean.warning")}</span>
    </div>

    <Checkbox bind:checked={includeUnmanaged} disabled={running} hint={t("deployment.clean.includeUnmanagedHint")}>
      <span class="text-xs">{t("deployment.clean.includeUnmanaged")}</span>
    </Checkbox>

    {#if preview.error}
      <ErrorText>{preview.error}</ErrorText>
    {:else if preview.loading && !preview.data}
      <p class="m-0 text-xs text-text-muted">{t("common.loading")}</p>
    {:else if preview.data}
      {@const data = preview.data}
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="min-w-0 space-y-1">
          <span class="block text-xs font-semibold text-text">
            {t("deployment.clean.dropTitle", { count: data.dropTables.length })}
          </span>
          {#if data.dropTables.length === 0}
            <p class="m-0 text-caption text-text-muted">{t("deployment.clean.nothing")}</p>
          {:else}
            <ul class="m-0 max-h-40 list-none space-y-0.5 overflow-y-auto p-0 font-mono text-caption" data-testid="clean-drop">
              {#each data.dropTables as table (table.name)}
                <li class="flex justify-between gap-2 text-text">
                  <span class="truncate">{table.name}</span>
                  <span class="shrink-0 text-text-muted">
                    {table.rows === null ? t("deployment.clean.rowsUnknown") : t("deployment.clean.rows", { count: table.rows })}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="min-w-0 space-y-1">
          <span class="block text-xs font-semibold text-text">
            {t("deployment.clean.createTitle", { count: data.createTables.length })}
          </span>
          <ul class="m-0 max-h-40 list-none space-y-0.5 overflow-y-auto p-0 font-mono text-caption text-text-muted">
            {#each data.createTables as name (name)}<li class="truncate">{name}</li>{/each}
          </ul>
        </div>
      </div>
      <p class="m-0 text-caption text-text-muted">{t("deployment.clean.seeds")}</p>
      <details class="text-caption text-text-muted">
        <summary class="cursor-pointer select-none">{t("deployment.clean.showSql")}</summary>
        <textarea readonly class={`${TEXTAREA_CODE_CLASS} mt-1 h-40 w-full`} value={data.sql}></textarea>
      </details>
    {/if}

    <Checkbox bind:checked={backupBefore} disabled={running} hint={t("deployment.clean.backupHint")}>
      <span class="text-xs">{t("deployment.clean.backup")}</span>
    </Checkbox>

    <label class="block text-xs text-text">
      <span class="mb-1 block font-semibold text-danger">{t("deployment.clean.confirm", { word: confirmWord })}</span>
      <Input bind:value={typed} autocomplete="off" placeholder={confirmWord} aria-label={t("deployment.clean.confirmWord")} />
    </label>

    {#if failure}
      <DeploymentFailureBlock {failure} {onShowInGraph} {onShowInCode} {tableExists} />
    {:else if error}
      <ErrorText>{error}</ErrorText>
    {/if}

    <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={running}>{t("common.cancel")}</Button>
      <Button size="sm" variant="danger" onclick={() => void run()} disabled={running || !confirmed || !ready}>
        {running ? t("deployment.clean.running") : t("deployment.clean.action")}
      </Button>
    </div>
  </div>
</Modal>
