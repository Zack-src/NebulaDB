<script lang="ts">
  import { autofocus } from "@/actions/autofocus";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { deleteMyAccount } from "@/services/usersApi";

  let { onClose, onDeleted }: { onClose: () => void; onDeleted: () => void } = $props();

  const { t } = useTranslation();
  let password = $state("");

  const deleteAccount = useAsyncAction(async () => {
    await deleteMyAccount(password);
    onDeleted();
  });
</script>

<Modal title={t("settings.personalData.deleteAccount")} {onClose}>
  <Hint>{t("settings.personalData.deleteConsequences")}</Hint>
  <label class="mt-4 block text-xs font-semibold text-text-secondary">
    {t("settings.personalData.confirmWithPassword")}
    <input
      class={`${INPUT_CLASS} mt-1 w-full`}
      type="password"
      use:autofocus
      autocomplete="current-password"
      bind:value={password}
    />
  </label>
  <Button
    variant="danger"
    class="mt-4"
    onclick={() => void deleteAccount.run()}
    disabled={deleteAccount.pending || !password}
  >
    {deleteAccount.pending ? t("common.deleting") : t("settings.personalData.deleteConfirm")}
  </Button>
  {#if deleteAccount.error}<ErrorText>{deleteAccount.error}</ErrorText>{/if}
</Modal>
