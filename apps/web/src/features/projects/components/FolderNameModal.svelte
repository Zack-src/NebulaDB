<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /** Names a new folder, or renames one: one field, saved by `onSave`. */
  let {
    title,
    initialName = "",
    onSave,
    onClose,
  }: {
    title: string;
    initialName?: string;
    onSave: (name: string) => Promise<void>;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  // svelte-ignore state_referenced_locally
  let name = $state(initialName);
  const save = useAsyncAction(async () => {
    await onSave(name.trim());
    onClose();
  });
</script>

<Modal {title} {onClose} narrow dismissable={!save.pending}>
  <form
    class="space-y-3"
    onsubmit={(event) => {
      event.preventDefault();
      if (name.trim()) void save.run();
    }}
  >
    <Input wrapperClassName="w-full" bind:value={name} aria-label={t("folders.name")} placeholder={t("folders.namePlaceholder")} autofocus maxlength={120} />
    {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
    <div class="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={save.pending}>{t("common.cancel")}</Button>
      <Button size="sm" variant="primary" type="submit" disabled={save.pending || !name.trim()}>
        {save.pending ? t("common.saving") : t("common.save")}
      </Button>
    </div>
  </form>
</Modal>
