<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import type { DatabaseEngine, DeploymentHistoryEntry } from "@nebuladb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon } from "@/components/icons/Icons";
  import { INPUT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { ApiError } from "@/services/ApiError";
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
  let backupChoice = $state<boolean | null>(null);
  const backupBefore = $derived(backupChoice ?? production);
  // Set once the server says the stage asks for a review: a project administrator may then go on, with a reason.
  let reviewSkipAsked = $state(false);
  let reviewSkipReason = $state("");
  const confirmed = $derived(
    (!production || typed.trim() === connectionName.trim()) && (!reviewSkipAsked || reviewSkipReason.trim() !== ""),
  );
  const rollback = useAsyncAction(async () => {
    try {
      await rollbackDeployment(projectId, connId, entry.id, {
        confirmName: production ? typed : undefined,
        backupBefore,
        skipReviewReason: reviewSkipAsked ? reviewSkipReason.trim() : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "ROLLBACK_REVIEW_REQUIRED") reviewSkipAsked = true;
      throw err;
    }
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
        <Input bind:value={typed} autocomplete="off" aria-label={t("environments.typeToConfirmLabel")} />
      </label>
    {/if}

    <Checkbox
      checked={backupBefore}
      onChange={(checked) => (backupChoice = checked)}
      hint={t("deployment.rollbackBackupBeforeHint")}
    >
      <span class="text-xs">{t("deployment.rollbackBackupBefore")}</span>
    </Checkbox>

    {#if reviewSkipAsked}
      <label class="block text-xs text-text">
        <span class="mb-1 block font-semibold">{t("deployment.rollbackSkipReviewLabel")}</span>
        <textarea
          class={`${INPUT_CLASS} h-14 w-full`}
          bind:value={reviewSkipReason}
          maxlength={300}
          placeholder={t("deployment.rollbackSkipReviewPlaceholder")}
        ></textarea>
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
