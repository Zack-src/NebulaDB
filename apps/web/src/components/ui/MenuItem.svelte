<script lang="ts">
  import { getContext, type Snippet } from "svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon } from "@/components/icons/Icons";
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import { CONTEXT_MENU_DANGER_ITEM_CLASS, CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
  import { MENU_CONTEXT, type MenuContext } from "@/components/ui/Menu.svelte";

  /**
   * One entry of a `Menu`. Selecting it runs `onSelect` and closes the menu;
   * `checked` turns it into a tick-able entry (pass `keepOpen` when several
   * can be toggled in a row).
   */
  let {
    onSelect,
    icon,
    shortcut,
    danger = false,
    disabled = false,
    checked,
    keepOpen = false,
    tooltip,
    children,
  }: {
    onSelect: () => void;
    icon?: IconDefinition;
    /** Shown right-aligned, as a reminder — the binding itself lives wherever the shortcut is handled. */
    shortcut?: string;
    danger?: boolean;
    disabled?: boolean;
    checked?: boolean;
    keepOpen?: boolean;
    tooltip?: string;
    children: Snippet;
  } = $props();

  const menu = getContext<MenuContext | undefined>(MENU_CONTEXT);
</script>

<button
  type="button"
  role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
  aria-checked={checked}
  tabindex={-1}
  {disabled}
  class={`${danger ? CONTEXT_MENU_DANGER_ITEM_CLASS : CONTEXT_MENU_ITEM_CLASS} disabled:cursor-not-allowed disabled:opacity-45`}
  data-tooltip={tooltip}
  data-tooltip-pos="left"
  onclick={() => {
    onSelect();
    if (!keepOpen) menu?.close();
  }}
>
  {#if icon}<Icon {icon} size={14} />{/if}
  <span class="min-w-0 flex-1 truncate">{@render children()}</span>
  {#if shortcut}<kbd class="shrink-0 font-sans text-caption font-normal text-text-muted">{shortcut}</kbd>{/if}
  {#if checked}<Icon icon={CheckIcon} size={13} class="!text-primary" />{/if}
</button>
