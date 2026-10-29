<script lang="ts">
  import { MAX_TEXT_LENGTH, storeMentions, type Comment } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import MentionTextArea, { type MentionCandidate } from "@/components/ui/MentionTextArea.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { formatTimestamp } from "./formatTimestamp";
  import CommentText from "./CommentText.svelte";
  import { commentDraftLimit } from "./commentNotice";
  import { searchMentionable } from "./mentionSearch";

  /** The comments of a thread and the box to add one: the content of a thread popover, or a section of another panel. */
  let {
    comments,
    currentUser,
    onAdd,
    onDelete,
  }: {
    comments: Comment[];
    currentUser: string;
    onAdd: (text: string) => void;
    onDelete: (commentId: string) => void;
  } = $props();

  const { t } = useTranslation();
  let draft = $state("");
  let picked = $state<MentionCandidate[]>([]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(storeMentions(text, picked));
    draft = "";
    picked = [];
  }
</script>

<div class="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto p-2">
  {#if comments.length === 0}
    <div class="px-0.5 py-1.5 text-xs text-text-muted">{t("comments.empty")}</div>
  {/if}
  {#each comments as c (c.id)}
    <div class="rounded-sm bg-surface p-1.5">
      <div class="mb-0.5 flex items-baseline gap-1.5">
        <span class="text-label font-bold text-text">{c.author}</span>
        <span class="flex-1 text-micro text-text-muted">{formatTimestamp(c.createdAt)}</span>
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
      <div class="whitespace-pre-wrap break-words text-body-sm leading-[1.4] text-text-secondary"><CommentText text={c.text} /></div>
    </div>
  {/each}
</div>
<div class="flex gap-1.5 border-t border-border p-2">
  <MentionTextArea
    variant="sm"
    bind:value={draft}
    bind:picked
    search={searchMentionable}
    onsubmit={submit}
    placeholder={t("comments.placeholder")}
    maxlength={commentDraftLimit(MAX_TEXT_LENGTH, picked.length)}
  />
  <Button variant="primary" size="sm" onclick={submit} disabled={!draft.trim()}>{t("comments.post")}</Button>
</div>
