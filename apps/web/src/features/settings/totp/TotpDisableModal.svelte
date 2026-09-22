<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Field from "@/components/ui/Field.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { disableTotp } from "@/services/authApi";

  let { onClose, onDisabled }: { onClose: () => void; onDisabled: () => void } = $props();

  const { t } = useTranslation();
  let password = $state("");
  let code = $state("");

  const disable = useAsyncAction(async () => {
    await disableTotp(password, code);
    onDisabled();
  });
</script>

<Modal title={t("totp.disableConfirmTitle")} {onClose}>
  <div class="space-y-4">
    <Hint>{t("totp.disableConfirmBody")}</Hint>
    <Field
      label={t("totp.disablePasswordLabel")}
      type="password"
      autocomplete="current-password"
      bind:value={password}
      autofocus
    />
    <Field
      label={t("totp.disableCodeLabel")}
      type="text"
      autocomplete="one-time-code"
      placeholder={t("totp.codePlaceholder")}
      bind:value={code}
    />
    {#if disable.error}<ErrorText>{disable.error}</ErrorText>{/if}
    <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={disable.pending}>{t("common.cancel")}</Button>
      <Button
        size="sm"
        variant="danger"
        onclick={() => void disable.run()}
        disabled={disable.pending || !password || !code}
      >
        {disable.pending ? t("common.saving") : t("totp.confirmDisable")}
      </Button>
    </div>
  </div>
</Modal>
