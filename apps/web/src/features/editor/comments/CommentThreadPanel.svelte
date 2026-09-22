<script lang="ts">
  import { MAX_TEXT_LENGTH, type Comment } from "@athanordb/shared";
  import { anchoredPlacement, provisionalPopoverStyle } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { TEXTAREA_SM_CLASS } from "@/components/ui/inputStyles";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { formatTimestamp } from "./formatTimestamp";

  let {
    comments,
    currentUser,
    onAdd,
    onDelete,
    triggerRect,
    trigger,
    onClose,
  }: {
    comments: Comment[];
    currentUser: string;
    onAdd: (text: string) => void;
    onDelete: (commentId: string) => void;
    triggerRect: DOMRect;
    trigger: HTMLElement | undefined;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let draft = $state("");
  let popover: HTMLDivElement | undefined = $state();

  useDismissablePopover(
    () => true,
    () => onClose(),
    () => [popover, trigger],
  );

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    draft = "";
  }
</script>

<div
  use:portal
  use:anchoredPlacement={{ rect: triggerRect }}
  bind:this={popover}
  class="fixed z-[var(--z-popover)] flex w-[260px] animate-modal-in flex-col rounded-md border border-border-strong bg-surface-raised shadow-lg nodrag"
  style={provisionalPopoverStyle(triggerRect)}
>
  <div class="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto p-2">
    {#if comments.length === 0}
      <div class="px-0.5 py-1.5 text-xs text-text-muted">{t("comments.empty")}</div>
    {/if}
    {#each comments as c (c.id)}
      <div class="rounded-sm bg-surface p-1.5">
        <div class="mb-0.5 flex items-baseline gap-1.5">
          <span class="text-[11.5px] font-bold text-text">{c.author}</span>
          <span class="flex-1 text-[10.5px] text-text-muted">{formatTimestamp(c.createdAt)}</span>
          {#if c.author === currentUser}
            <button
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-danger-light hover:text-danger"
              onclick={() => onDelete(c.id)}
              data-tooltip={t("comments.delete")}
              aria-label={t("comments.delete")}
            >
              <Icon icon={CloseIcon} size={11} />
            </button>
          {/if}
        </div>
        <div class="whitespace-pre-wrap break-words text-[12.5px] leading-[1.4] text-text-secondary">{c.text}</div>
      </div>
    {/each}
  </div>
  <div class="flex gap-1.5 border-t border-border p-2">
    <textarea
      class={`${TEXTAREA_SM_CLASS} flex-1`}
      bind:value={draft}
      placeholder={t("comments.placeholder")}
      maxlength={MAX_TEXT_LENGTH}
      onkeydown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
      }}
    ></textarea>
    <Button variant="primary" size="sm" onclick={submit} disabled={!draft.trim()}>{t("comments.post")}</Button>
  </div>
</div>
