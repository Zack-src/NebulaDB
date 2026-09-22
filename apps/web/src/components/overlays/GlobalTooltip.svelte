<script lang="ts" module>
  type TooltipPos = "top" | "bottom" | "left";

  interface TooltipState {
    text: string;
    /** Longer free text (a column/table note) shown under `text` — left-aligned, wider box, never truncated mid-word. */
    note: string | null;
    rect: DOMRect;
    pos: TooltipPos;
  }

  const SHOW_DELAY = 400;
  /** A note is the reason the user is hovering, so don't make them wait the full delay for it. */
  const NOTE_SHOW_DELAY = 150;
  /** Viewport margin, and the top offset that keeps the box clear of the app header. */
  const MARGIN = 8;
  const TOP_LIMIT = 34;
</script>

<script lang="ts">
  import { portal } from "@/actions/portal";

  /**
   * Single delegated tooltip for every `data-tooltip` element in the app.
   * Portaled to `document.body` and positioned with `position: fixed` from the
   * hovered element's own rect, so it never gets clipped by an ancestor's
   * `overflow: hidden`/`auto` (the header's horizontal scroll area, the canvas
   * panels, etc.) the way a CSS `::after` on the element itself would be. Mount
   * once near the app root.
   *
   * `data-tooltip-note` adds a second block under the label for free text
   * (column/table notes): wider, left-aligned, wrapped in full rather than
   * truncated. Because such a box can be tall, placement is measured after
   * render — it flips below the target and clamps to the viewport instead of
   * running off the top of the screen.
   */
  let tooltip = $state.raw<TooltipState | null>(null);
  let box: HTMLDivElement | undefined = $state();
  let timer: number | undefined;
  let target: Element | null = null;

  $effect(() => {
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const hide = () => {
      clearTimer();
      target = null;
      // `mouseout`/`mousedown`/`scroll` are native events, and the browser can
      // dispatch one *synchronously* as a side effect of a Svelte-triggered
      // DOM change (e.g. the hovered element gets hidden or removed by an
      // unrelated `$derived` update) — mid-render, on the same call stack.
      // Writing `$state` there is what Svelte's `state_unsafe_mutation` catches;
      // deferring by a tick keeps the fix (tooltip hides) without writing
      // state while a render is still in progress.
      queueMicrotask(() => (tooltip = null));
    };

    const show = (el: Element) => {
      if (!el || !el.isConnected || target !== el) return;
      const text = el.getAttribute("data-tooltip");
      if (!text) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0) return;
      const pos = (el.getAttribute("data-tooltip-pos") as TooltipPos | null) ?? "top";
      tooltip = { text, note: el.getAttribute("data-tooltip-note") || null, rect, pos };
    };

    const onOver = (event: Event) => {
      const el = (event.target as Element | null)?.closest?.("[data-tooltip]");
      if (!el || el === target) return;
      clearTimer();
      target = el;
      const delay = el.hasAttribute("data-tooltip-note") ? NOTE_SHOW_DELAY : SHOW_DELAY;
      timer = window.setTimeout(() => show(el), delay);
    };

    const onOut = (event: Event) => {
      if (!target) return;
      const related = (event as MouseEvent).relatedTarget as Node | null;
      if (related && target.contains(related)) return;
      hide();
    };

    const onMove = (event: MouseEvent) => {
      if (!target) return;
      if (!target.isConnected) {
        hide();
        return;
      }
      const targetUnderCursor = document.elementFromPoint(event.clientX, event.clientY);
      if (targetUnderCursor && !target.contains(targetUnderCursor)) {
        hide();
      }
    };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("mousemove", onMove, { passive: true, capture: true });
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("focusout", onOut, true);
    document.addEventListener("mousedown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);

    return () => {
      clearTimer();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("focusout", onOut, true);
      document.removeEventListener("mousedown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  });

  // Placement is a DOM write (no extra render): the box renders hidden at 0,0,
  // gets measured, then moved into place and revealed.
  $effect(() => {
    const current = tooltip;
    if (!box || !current) return;
    const { rect, pos } = current;
    const w = box.offsetWidth;
    const h = box.offsetHeight;

    let left: number;
    let top: number;
    if (pos === "left") {
      left = rect.left - MARGIN - w;
      top = rect.top + rect.height / 2 - h / 2;
    } else if (pos === "bottom") {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.bottom + MARGIN;
    } else {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.top - MARGIN - h;
      // not enough room above (tall note boxes especially) -> flip below
      if (top < TOP_LIMIT) top = rect.bottom + MARGIN;
    }

    box.style.left = `${Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - w - MARGIN))}px`;
    box.style.top = `${Math.min(Math.max(TOP_LIMIT, top), Math.max(TOP_LIMIT, window.innerHeight - h - MARGIN))}px`;
    box.style.visibility = "visible";
  });
</script>

{#if tooltip}
  <!-- Keyed per target so a new tooltip always starts from the hidden/0,0
       point and can never flash at the previous one's coordinates. -->
  {#key tooltip}
    <div
      use:portal
      bind:this={box}
      class={`pointer-events-none fixed left-0 top-0 z-[var(--z-tooltip)] w-max whitespace-pre-line rounded-sm border border-border-strong bg-surface-raised font-sans text-[11px] font-medium leading-[1.35] text-text shadow-md ${
        tooltip.note
          ? "max-h-[70vh] max-w-[340px] overflow-hidden rounded-md px-2.5 py-2 text-left"
          : "max-w-[240px] px-2 py-[5px] text-center"
      }`}
      style="visibility: hidden"
    >
      {tooltip.text}
      {#if tooltip.note}
        <span class="my-1.5 block h-px bg-border"></span>
        <span class="block break-words text-[11.5px] font-normal leading-[1.45] text-text-secondary">{tooltip.note}</span>
      {/if}
    </div>
  {/key}
{/if}
