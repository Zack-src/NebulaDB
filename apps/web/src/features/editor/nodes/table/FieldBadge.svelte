<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { KeyIcon, LinkIcon } from "@/components/icons/Icons";

  /**
   * The column's *role* icon: key (PK) > link (FK) > nothing. Rendered as the
   * leading member of `TableNodeRow`'s trailing badge group, alongside the
   * attribute badges (unique / not null / increment / note), so a column's
   * whole set of indicators reads as one tight cluster instead of the role
   * icon sitting off on its own next to the name.
   */
  let { isForeignKey, isPk }: { isForeignKey: boolean; isPk: boolean } = $props();
</script>

{#if isPk}
  <Icon icon={KeyIcon} size={16} class="h-4 w-4 shrink-0 text-warning" />
{:else if isForeignKey}
  <Icon icon={LinkIcon} size={16} class="h-4 w-4 shrink-0 text-text-muted" />
{/if}
