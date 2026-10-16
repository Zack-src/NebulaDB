<script lang="ts" module>
  import type { IconDefinition } from "@/components/icons/iconDefinition";

  /** One entry, or `"separator"` for a hairline between groups. */
  export type ContextMenuEntry =
    | { label: string; icon?: IconDefinition; danger?: boolean; disabled?: boolean; onSelect: () => void }
    | "separator";
</script>

<script lang="ts">
  import { menuPlacement } from "@/actions/placement";
  import Icon from "@/components/icons/Icon.svelte";
  import {
    CONTEXT_MENU_CLASS,
    CONTEXT_MENU_DANGER_ITEM_CLASS,
    CONTEXT_MENU_ITEM_CLASS,
    CONTEXT_MENU_SEPARATOR_CLASS,
  } from "@/components/ui/contextMenuStyles";

  /**
   * A right-click menu at the pointer, outside the canvas: closes on a click
   * elsewhere, Escape, scrolling or resizing, and after an entry is chosen.
   * Focus goes to the first entry so it can be used from the keyboard.
   */
  let {
    x,
    y,
    entries,
    label,
    onClose,
  }: { x: number; y: number; entries: ContextMenuEntry[]; label: string; onClose: () => void } = $props();

  let menu: HTMLDivElement | undefined = $state();

  $effect(() => {
    menu?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (event: Event) => {
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Captured so a click that starts another action closes the menu before it runs.
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  });

  function move(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }
</script>

<div
  bind:this={menu}
  use:menuPlacement={{ x, y }}
  class={CONTEXT_MENU_CLASS}
  role="menu"
  aria-label={label}
  tabindex="-1"
  onkeydown={move}
  oncontextmenu={(event) => event.preventDefault()}
>
  {#each entries as entry, index (index)}
    {#if entry === "separator"}
      <div class={CONTEXT_MENU_SEPARATOR_CLASS}></div>
    {:else}
      <button
        role="menuitem"
        class={entry.danger ? CONTEXT_MENU_DANGER_ITEM_CLASS : CONTEXT_MENU_ITEM_CLASS}
        disabled={entry.disabled}
        onclick={() => {
          onClose();
          entry.onSelect();
        }}
      >
        {#if entry.icon}<Icon icon={entry.icon} size={14} />{/if}
        {entry.label}
      </button>
    {/if}
  {/each}
</div>
