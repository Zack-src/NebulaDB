<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let { codes, onClose }: { codes: string[]; onClose: () => void } = $props();

  const { t } = useTranslation();
  let confirmed = $state(false);
</script>

<Modal title={t("totp.backupCodesTitle")} {onClose}>
  <div class="space-y-4">
    <Hint>{t("totp.backupCodesIntro")}</Hint>
    <div class="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-raised p-3">
      {#each codes as code (code)}
        <code class="text-center text-xs text-text">{code}</code>
      {/each}
    </div>
    <Checkbox bind:checked={confirmed} class="select-none">
      <span class="text-xs text-text-secondary">{t("totp.backupCodesConfirm")}</span>
    </Checkbox>
    <div class="flex items-center justify-end border-t border-border pt-3">
      <Button size="sm" variant="primary" onclick={onClose} disabled={!confirmed} class="gap-1.5">
        <Icon icon={CheckIcon} size={13} />
        {t("common.close")}
      </Button>
    </div>
  </div>
</Modal>
