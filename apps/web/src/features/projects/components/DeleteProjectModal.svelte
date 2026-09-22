<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { ProjectSummary } from "@/types";

  /** Confirms permanently deleting one trashed project (and its revision history). */
  let {
    target,
    busy,
    error,
    onConfirm,
    onClose,
  }: {
    target: ProjectSummary;
    busy: boolean;
    error: string | null;
    onConfirm: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<Modal title={t("projects.deleteForever.title")} {onClose}>
  <Hint>{t("projects.deleteForever.confirmation", { name: target.name })}</Hint>
  <div class="flex justify-end gap-2">
    <Button onclick={onClose} disabled={busy}>{t("common.cancel")}</Button>
    <Button variant="danger" onclick={onConfirm} disabled={busy}>
      {busy ? t("common.deleting") : t("projects.deleteForever.action")}
    </Button>
  </div>
  {#if error}<ErrorText>{error}</ErrorText>{/if}
</Modal>
