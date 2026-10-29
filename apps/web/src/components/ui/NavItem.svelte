<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import type { IconDefinition } from "@/components/icons/iconDefinition";

  /**
   * One entry of a side navigation (admin console, settings): an icon and a
   * label, filled in the primary tint while it is the current page. Entries
   * are real buttons — `aria-current="page"` carries the state for assistive
   * tech — so a screen that needs a different look for its menu is a sign it
   * should use `Tabs` or `MenuItem` instead.
   */
  let {
    label,
    icon,
    active = false,
    onclick,
  }: { label: string; icon?: IconDefinition; active?: boolean; onclick: () => void } = $props();
</script>

<button
  type="button"
  aria-current={active ? "page" : undefined}
  class={`flex w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-md border-0 px-3 py-2.5 text-left text-body transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-text ${
    active
      ? "bg-primary-light font-semibold text-primary-text"
      : "bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text"
  }`}
  {onclick}
>
  {#if icon}<Icon {icon} size={16} />{/if}
  <span>{label}</span>
</button>
