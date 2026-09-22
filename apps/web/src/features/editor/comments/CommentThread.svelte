<script lang="ts">
  import type { Comment } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CommentIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import CommentThreadPanel from "./CommentThreadPanel.svelte";

  /**
   * Small comment-thread trigger + popover, used both on a table's header
   * (table-level comments) and on individual field rows (field-level) — the
   * popover is portaled to `document.body` for the same reason as
   * `ColorSwatchPicker`: both live inside a canvas node, which clips overflow
   * and gets CSS-transformed for pan/zoom.
   */
  let {
    comments,
    currentUser,
    onAdd,
    onDelete,
    triggerClassName,
    tooltip,
  }: {
    comments: Comment[];
    currentUser: string;
    onAdd: (text: string) => void;
    onDelete: (commentId: string) => void;
    triggerClassName: string;
    tooltip?: string;
  } = $props();

  const { t } = useTranslation();
  let open = $state(false);
  let triggerRect = $state.raw<DOMRect | null>(null);
  let trigger: HTMLButtonElement | undefined = $state();

  function toggle() {
    if (!open && trigger) triggerRect = trigger.getBoundingClientRect();
    open = !open;
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class={`nodrag ${triggerClassName}${comments.length > 0 ? " has-comments" : ""}`}
  onclick={(event) => {
    event.stopPropagation();
    toggle();
  }}
  ondblclick={(event) => event.stopPropagation()}
  data-tooltip={tooltip ?? t("comments.title")}
  aria-label={tooltip ?? t("comments.title")}
>
  <Icon icon={CommentIcon} size={12} />
  {#if comments.length > 0}
    <span class="text-[10px] font-bold leading-none">{comments.length}</span>
  {/if}
</button>
{#if open && triggerRect}
  <CommentThreadPanel {comments} {currentUser} {onAdd} {onDelete} {triggerRect} {trigger} onClose={() => (open = false)} />
{/if}
