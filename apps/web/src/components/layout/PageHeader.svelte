<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import type { IconDefinition } from "@/components/icons/iconDefinition";

  /**
   * The title block of a top-level page: an icon chip, the title, an optional
   * line under it, and the page's actions on the right (they wrap under the
   * title on a narrow screen). Every page of the shell — projects, databases,
   * each admin section — starts with this, so the titles line up from one
   * page to the next.
   */
  let {
    title,
    icon,
    description,
    actions,
    testid,
  }: { title: string; icon?: IconDefinition; description?: string; actions?: Snippet; testid?: string } = $props();
</script>

<div class="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-center">
  <div class="flex items-center gap-2.5">
    {#if icon}
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
        <Icon {icon} size={18} />
      </span>
    {/if}
    <div class="min-w-0">
      <h1 class="m-0 text-xl font-semibold tracking-tight text-text" data-testid={testid}>{title}</h1>
      {#if description}<p class="m-0 text-label text-text-muted">{description}</p>{/if}
    </div>
  </div>
  {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</div>
