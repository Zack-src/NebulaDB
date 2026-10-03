<script lang="ts">
  import type { DatabaseEngine, DeploymentHistoryEntry } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon } from "@/components/icons/Icons";
  import { INPUT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { rollbackDeployment } from "@/services/connectionsApi";

  let {
    projectId,
    connId,
    entry,
    engine,
    production = false,
    connectionName = "",
    onClose,
    onRolledBack,
  }: {
    projectId: string;
    connId: string;
    entry: DeploymentHistoryEntry;
    engine?: DatabaseEngine;
    /** The connection is on the production stage: its name has to be typed first. */
    production?: boolean;
    connectionName?: string;
    onClose: () => void;
    onRolledBack: () => void;
  } = $props();

  const { t } = useTranslation();
  let typed = $state("");
  const confirmed = $derived(!production || typed.trim() === connectionName.trim());
  const rollback = useAsyncAction(async () => {
    await rollbackDeployment(projectId, connId, entry.id, production ? typed : undefined);
    onRolledBack();
  });
</script>

<Modal title={t("deployment.rollbackConfirmTitle")} {onClose}>
  <div class="space-y-3">
    <Hint>{t("deployment.rollbackConfirmBody")}</Hint>

    {#if engine === "mysql"}
      <div class="flex items-start gap-2 rounded-sm border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-300">
        <Icon icon={AlertTriangleIcon} size={14} class="mt-px shrink-0" />
        <span>{t("deployment.rollbackWarningMysql")}</span>
      </div>
    {/if}

    <textarea readonly class={`${TEXTAREA_CODE_CLASS} h-48 w-full`} value={entry.rollbackSql ?? ""}></textarea>

    {#if production}
      <label class="block text-xs text-text">
        <span class="mb-1 block font-semibold text-danger">{t("environments.typeToConfirm", { name: connectionName })}</span>
        <input class={INPUT_CLASS} bind:value={typed} autocomplete="off" aria-label={t("environments.typeToConfirmLabel")} />
      </label>
    {/if}

    {#if rollback.error}<ErrorText>{rollback.error}</ErrorText>{/if}

    <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={rollback.pending}>{t("common.cancel")}</Button>
      <Button size="sm" variant="danger" onclick={() => void rollback.run()} disabled={rollback.pending || !confirmed}>
        {rollback.pending ? t("deployment.rollingBack") : t("deployment.rollbackConfirmAction")}
      </Button>
    </div>
  </div>
</Modal>
