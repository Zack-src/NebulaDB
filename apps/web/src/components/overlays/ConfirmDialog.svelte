<script lang="ts" module>
  export type ConfirmDanger = "none" | "warning" | "danger";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";

    /**
     * The one "are you sure?" dialog. `danger` sets the friction:
     *  - `none`: a plain question;
     *  - `warning`: something is lost but can be redone; amber;
     *  - `danger`: irreversible; red, focus starts on **Cancel**.
     * `requireText` makes the user retype a name before the confirm button enables.
     *
     * It does not close itself: the caller passes `pending` (locks Escape and the backdrop) and
     * `error`, and unmounts it when the work is done.
     */
  let {
    title,
    message,
    children,
    confirmLabel,
    cancelLabel,
    danger = "none",
    requireText,
    pending = false,
    error,
    onConfirm,
    onCancel,
  }: {
    title: string;
    message?: string;
    /** Extra content under the message — a SQL preview, the list of what goes with it. */
    children?: Snippet;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: ConfirmDanger;
    requireText?: string;
    pending?: boolean;
    error?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  const { t } = useTranslation();
  let typed = $state("");
  let cancelButton: HTMLButtonElement | null = $state(null);
  let confirmButton: HTMLButtonElement | null = $state(null);
  const ready = $derived(!pending && (requireText === undefined || typed === requireText));

  // Once, on open. The retype field focuses itself; otherwise the safe button
  // of a destructive question, and the expected one of a harmless question.
  $effect(() => {
    if (requireText !== undefined) return;
    (danger === "danger" ? cancelButton : confirmButton)?.focus();
  });
</script>

<Modal {title} onClose={onCancel} narrow dismissable={!pending}>
  <form
    class="flex flex-col gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      if (ready) onConfirm();
    }}
  >
    {#if message}
      <div class="flex items-start gap-2.5 text-body leading-relaxed text-text-secondary">
        {#if danger !== "none"}
          <Icon
            icon={AlertTriangleIcon}
            size={16}
            class={`mt-0.5 shrink-0 ${danger === "danger" ? "text-danger" : "text-warning"}`}
          />
        {/if}
        <p class="m-0 min-w-0 whitespace-pre-line break-words">{message}</p>
      </div>
    {/if}

    {@render children?.()}

    {#if requireText !== undefined}
      <label class="flex flex-col gap-1.5">
        <span class={LABEL_CLASS}>{t("ui.confirm.typeToConfirm", { text: requireText })}</span>
        <Input bind:value={typed} autofocus autocomplete="off" spellcheck="false" disabled={pending} wrapperClassName="w-full" />
      </label>
    {/if}

    {#if error}<ErrorText>{error}</ErrorText>{/if}

    <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button bind:ref={cancelButton} size="sm" variant="ghost" onclick={onCancel} disabled={pending}>
        {cancelLabel ?? t("common.cancel")}
      </Button>
      <Button
        bind:ref={confirmButton}
        type="submit"
        size="sm"
        variant={danger === "none" ? "primary" : "danger"}
        class={danger === "warning" ? "!border-warning-border !bg-warning-light !text-warning" : ""}
        disabled={!ready}
      >
        {confirmLabel ?? t("common.confirm")}
      </Button>
    </div>
  </form>
</Modal>
