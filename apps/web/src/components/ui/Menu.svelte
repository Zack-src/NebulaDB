<script lang="ts" module>
  export const MENU_CONTEXT = Symbol("menu");

  export interface MenuContext {
    close: () => void;
  }

  /** What the `trigger` snippet spreads onto its button. */
  export interface MenuTriggerProps {
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
    onclick: (event: MouseEvent) => void;
    onkeydown: (event: KeyboardEvent) => void;
  }

  const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';
</script>

<script lang="ts">
  import { setContext, tick, type Snippet } from "svelte";
  import Popover from "@/components/ui/Popover.svelte";

  /**
   * A dropdown menu: any button as the trigger, `MenuItem`s as the content.
   *
   *   <Menu aria-label="Actions">
   *     {#snippet trigger(props)}<Button {...props}>Actions</Button>{/snippet}
   *     <MenuItem onSelect={rename}>Renommer</MenuItem>
   *   </Menu>
   *
   * Keyboard follows the ARIA menu-button pattern: Enter / Space / ArrowDown on
   * the trigger open it on the first entry (ArrowUp on the last), arrows and
   * Home / End move, a letter jumps to the next entry starting with it, Escape
   * and Tab close and hand focus back to the trigger. Opened with the mouse,
   * nothing is highlighted until an arrow key is pressed.
   */
  let {
    trigger,
    children,
    side = "bottom",
    minWidth = 184,
    "aria-label": ariaLabel,
  }: {
    trigger: Snippet<[MenuTriggerProps, boolean]>;
    children: Snippet;
    side?: "bottom" | "top" | "right";
    minWidth?: number;
    "aria-label"?: string;
  } = $props();

  const id = $props.id();
  let open = $state(false);
  let anchor: HTMLSpanElement | undefined = $state();
  let menu: HTMLDivElement | null = $state(null);

  const items = () => Array.from(menu?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  async function show(focus: "first" | "last" | "menu") {
    open = true;
    await tick();
    const list = items();
    if (focus === "first") (list[0] ?? menu)?.focus();
    else if (focus === "last") (list[list.length - 1] ?? menu)?.focus();
    else menu?.focus();
  }

  function close() {
    if (!open) return;
    // Only when focus is still in the menu: after a click elsewhere it already
    // sits on whatever the user clicked, and pulling it back would undo that.
    const restore = menu?.contains(document.activeElement);
    open = false;
    if (restore) anchor?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
  }

  setContext<MenuContext>(MENU_CONTEXT, { close });

  const triggerProps: MenuTriggerProps = $derived({
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    onclick: (event: MouseEvent) => {
      if (open) close();
      // `detail === 0`: the click was synthesised from Enter / Space.
      else void show(event.detail === 0 ? "first" : "menu");
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      void show(event.key === "ArrowDown" ? "first" : "last");
    },
  });

  function handleKeyDown(event: KeyboardEvent) {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (index: number) => {
      event.preventDefault();
      list[(index + list.length) % list.length]?.focus();
    };

    if (event.key === "ArrowDown") focusAt(current + 1);
    else if (event.key === "ArrowUp") focusAt(current === -1 ? list.length - 1 : current - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(list.length - 1);
    // Not prevented: focus goes back to the trigger first, so Tab then moves on
    // from where the menu was opened rather than from the end of the document.
    else if (event.key === "Tab") close();
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLowerCase();
      const ordered = [...list.slice(current + 1), ...list.slice(0, current + 1)];
      ordered.find((item) => item.textContent?.trim().toLowerCase().startsWith(letter))?.focus();
    }
  }
</script>

<span bind:this={anchor} class="inline-flex">
  {@render trigger(triggerProps, open)}
</span>
<Popover
  {open}
  {anchor}
  {side}
  onClose={close}
  bind:ref={menu}
  {id}
  role="menu"
  tabindex={-1}
  aria-label={ariaLabel}
  class="p-1 outline-hidden"
  onkeydown={handleKeyDown}
>
  <div style="min-width: {minWidth - 10}px">
    {@render children()}
  </div>
</Popover>
