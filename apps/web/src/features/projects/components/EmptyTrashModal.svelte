<script lang="ts">
  import { autofocus } from "@/actions/autofocus";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Confirms permanently emptying the trash. Typing the exact word is the guard
   * against "misclick nukes everything" — a click-through confirm is not enough
   * friction for an action this destructive and irreversible. The word itself is
   * translated: asking a French reader to type an English word (or the reverse)
   * turns a deliberate check into a transcription puzzle.
   */
  let {
    count,
    busy,
    error,
    onConfirm,
    onClose,
  }: {
    count: number;
    busy: boolean;
    error: string | null;
    onConfirm: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  const confirmWord = $derived(t("projects.emptyTrash.confirmWord"));
  let typedWord = $state("");
</script>

<Modal title={t("projects.emptyTrash.title")} onClose={() => !busy && onClose()}>
  <Hint>{t("projects.emptyTrash.consequences", { count })}</Hint>
  <Hint>{t("projects.emptyTrash.typeToConfirm", { word: confirmWord })}</Hint>
  <input
    use:autofocus
    class={`${INPUT_CLASS} w-full`}
    bind:value={typedWord}
    placeholder={confirmWord}
    disabled={busy}
  />
  <div class="mt-3 flex justify-end gap-2">
    <Button onclick={onClose} disabled={busy}>{t("common.cancel")}</Button>
    <Button variant="danger" onclick={onConfirm} disabled={busy || typedWord !== confirmWord}>
      {busy ? t("common.deleting") : t("projects.emptyTrash.action")}
    </Button>
  </div>
  {#if error}<ErrorText>{error}</ErrorText>{/if}
</Modal>
