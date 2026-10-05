<script lang="ts">
  import { parseCommentText } from "@athanordb/shared";
  import { commentsSession } from "./commentsSession";

  /**
   * A comment's text, its `@mentions` set off. A mention of the reader is
   * stronger than the others — it is the one that was written to them.
   */
  let { text }: { text: string } = $props();
  const segments = $derived(parseCommentText(text));
  const me = commentsSession.get()?.userId;
</script>

{#each segments as segment, index (index)}
  {#if segment.type === "mention"}
    <span
      class={`rounded-sm px-0.5 font-semibold ${segment.userId === me ? "bg-warning-light text-warning" : "bg-primary-light text-primary"}`}
      data-mention={segment.userId}>@{segment.name}</span
    >
  {:else}{segment.text}{/if}
{/each}
