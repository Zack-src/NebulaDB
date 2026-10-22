<script lang="ts">
  import type { Comment } from "@nebuladb/shared";
  import { anchoredPlacement, provisionalPopoverStyle } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import CommentThreadBody from "./CommentThreadBody.svelte";

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

  let popover: HTMLDivElement | undefined = $state();

  useDismissablePopover(
    () => true,
    () => onClose(),
    () => [popover, trigger],
  );
</script>

<div
  use:portal
  use:anchoredPlacement={{ rect: triggerRect }}
  bind:this={popover}
  class="fixed z-[var(--z-popover)] flex w-[260px] animate-modal-in flex-col rounded-md border border-border-strong bg-surface-raised shadow-lg nodrag"
  style={provisionalPopoverStyle(triggerRect)}
>
  <CommentThreadBody {comments} {currentUser} {onAdd} {onDelete} />
</div>
