<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Field from "@/components/ui/Field.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { regenerateBackupCodes } from "@/services/authApi";

  let { onClose, onRegenerated }: { onClose: () => void; onRegenerated: (codes: string[]) => void } = $props();

  const { t } = useTranslation();
  let password = $state("");

  const regenerate = useAsyncAction(async () => {
    const result = await regenerateBackupCodes(password);
    onRegenerated(result.backupCodes);
  });
</script>

<Modal title={t("totp.regenerateConfirmTitle")} {onClose}>
  <div class="space-y-4">
    <Hint>{t("totp.regenerateConfirmBody")}</Hint>
    <Field
      label={t("totp.regeneratePasswordLabel")}
      type="password"
      autocomplete="current-password"
      bind:value={password}
      autofocus
    />
    {#if regenerate.error}<ErrorText>{regenerate.error}</ErrorText>{/if}
    <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={regenerate.pending}>{t("common.cancel")}</Button>
      <Button size="sm" variant="primary" onclick={() => void regenerate.run()} disabled={regenerate.pending || !password}>
        {regenerate.pending ? t("common.saving") : t("totp.regenerateButton")}
      </Button>
    </div>
  </div>
</Modal>
