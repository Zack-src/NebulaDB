<script lang="ts" module>
  const DEFAULT_MENU_WIDTH = 180;
  const VIEWPORT_MARGIN = 8;
  /** Gap between the menu and the trigger it hangs off. */
  const TRIGGER_GAP = 8;
  /** A menu shorter than this is not worth flipping for — it scrolls instead. */
  const MIN_MENU_HEIGHT = 140;

  /**
   * Measured after mount rather than guessed at click time. Anchoring purely
   * from the bottom edge, as this did once, meant a long menu (the plugin
   * list, say) simply grew off the top of the window with its first entries
   * unreachable — there was no clamp and no max-height anywhere.
   */
  function placeAboveTrigger(menu: HTMLElement, { trigger, width }: { trigger: HTMLElement | undefined; width: number }) {
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.scrollHeight;
    const above = rect.top - TRIGGER_GAP - VIEWPORT_MARGIN;
    const below = window.innerHeight - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
    // Toolbars sit at the bottom of the canvas, so above is the natural side —
    // flip only when it genuinely cannot fit and below is roomier.
    const openDown = menuHeight > above && below > above;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    );

    const style = menu.style;
    style.left = `${left}px`;
    style.minWidth = `${width}px`;
    style.maxHeight = `${Math.max(MIN_MENU_HEIGHT, openDown ? below : above)}px`;
    style.overflowY = "auto";
    if (openDown) {
      style.top = `${rect.bottom + TRIGGER_GAP}px`;
      style.bottom = "";
    } else {
      style.bottom = `${window.innerHeight - rect.top + TRIGGER_GAP}px`;
      style.top = "";
    }
    style.visibility = "";
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { portal } from "@/actions/portal";
  import { CONTEXT_MENU_CLASS } from "@/components/ui/contextMenuStyles";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";

  /**
   * Popover behaviour shared by every dropdown in the floating canvas toolbar
   * (detail level, zoom, plugins). The menu is portalled to `document.body`
   * and anchored *above* its trigger, since the toolbar sits at the bottom of
   * the canvas.
   */
  let {
    triggerClassName,
    triggerContent,
    tooltip,
    minWidth,
    children,
  }: {
    /** Classes for the trigger button itself — it must be a real box, since the menu is anchored off its rect. */
    triggerClassName: (open: boolean) => string;
    triggerContent: Snippet;
    tooltip: string;
    minWidth?: number;
    children: Snippet<[() => void]>;
  } = $props();

  let open = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();
  let menu: HTMLDivElement | undefined = $state();
  const width = $derived(minWidth ?? DEFAULT_MENU_WIDTH);

  // Popover behaviour, not a mousedown outside-click: the canvas pane stops
  // mousedown propagation for its own pan/drag handling, so a mousedown
  // listener never sees clicks on the canvas itself.
  useDismissablePopover(
    () => open,
    () => (open = false),
    () => [menu, trigger],
  );

  const close = () => (open = false);
</script>

<button
  bind:this={trigger}
  type="button"
  class={triggerClassName(open)}
  onclick={(event) => {
    event.stopPropagation();
    open = !open;
  }}
  data-tooltip={tooltip}
  data-tooltip-pos="bottom"
>
  {@render triggerContent()}
</button>
{#if open}
  <!-- `overflow-hidden` from the shared class would clip the entries a
       scrolling menu is meant to reveal, so it is dropped here and the
       measured `maxHeight` scrolls instead. -->
  <div
    use:portal
    use:placeAboveTrigger={{ trigger, width }}
    bind:this={menu}
    class={`${CONTEXT_MENU_CLASS} overflow-y-auto`}
    style="left: -9999px; top: 0; min-width: {width}px; visibility: hidden"
  >
    {@render children(close)}
  </div>
{/if}
