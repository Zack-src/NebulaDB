<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { anchoredPlacement } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";

    /**
     * A floating panel hung off the control that opened it: the positioning and dismissal engine
     * under `Menu`, `Select` and ad-hoc popovers. Portalled to `document.body`, follows its anchor,
     * closes on Escape or an outside click (the anchor counts as inside). Focus is the caller's.
     */
  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "class" | "style"> {
    open: boolean;
    anchor: HTMLElement | null | undefined;
    onClose: () => void;
    side?: "bottom" | "top" | "right";
    matchWidth?: boolean;
    class?: string;
    ref?: HTMLDivElement | null;
    children: Snippet;
  }

  let {
    open,
    anchor,
    onClose,
    side = "bottom",
    matchWidth = false,
    class: className = "",
    ref = $bindable(null),
    children,
    ...rest
  }: Props = $props();

  /** Bumped whenever the anchor may have moved on screen. */
  let moved = $state(0);
  // Derived rather than measured in an effect: the panel is then in the DOM in
  // the same flush that opened it, so a caller can `await tick()` and focus it.
  const rect = $derived.by(() => {
    void moved;
    return open && anchor ? anchor.getBoundingClientRect() : null;
  });

  useDismissablePopover(
    () => open,
    () => onClose(),
    () => [ref, anchor],
  );

  $effect(() => {
    if (!open) return;
    const remeasure = () => (moved += 1);
    // Capture: scroll does not bubble, and the anchor may sit in any scroller.
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
    };
  });
</script>

{#if open && rect}
  <!-- The style is a constant on purpose: `anchoredPlacement` writes the real
       position onto the element, and a reactive `style` would wipe it (and
       hide the panel again) every time the anchor is re-measured. -->
  <div
    use:portal
    use:anchoredPlacement={{ rect, side, matchWidth }}
    bind:this={ref}
    class={`fixed z-[var(--z-popover)] max-w-[calc(100vw-16px)] animate-modal-in rounded-md border border-border-strong bg-surface-raised shadow-lg ${className}`.trim()}
    style="left: 0; top: 0; visibility: hidden"
    {...rest}
  >
    {@render children()}
  </div>
{/if}
