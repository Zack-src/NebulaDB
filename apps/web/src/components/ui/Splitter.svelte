<script lang="ts">
  /**
   * The draggable edge between two stacked or side-by-side panes. It owns no
   * layout: it reports the size the *controlled* pane should take, and the
   * parent applies it — so the same handle resizes a bottom drawer, a side
   * panel, or anything else that has a pixel size.
   *
   *   <Splitter bind:size={panelHeight} min={160} max={600} edge="top" aria-label="…" />
   *   <div style:height="{panelHeight}px">…</div>
   *
   * `edge` says which edge of the controlled pane the handle sits on, which is
   * what decides the direction: on a pane's top edge, dragging *up* enlarges it.
   *
   * A real `separator`: focusable, arrow keys move it by 16px (Shift: 64px),
   * Home / End go to the bounds, and the value is exposed to assistive tech.
   * Persisting the size is the caller's business (`utils/storage`).
   */
  let {
    size = $bindable(),
    min,
    max,
    edge,
    onCommit,
    "aria-label": ariaLabel,
  }: {
    size: number;
    min: number;
    max: number;
    edge: "top" | "bottom" | "left" | "right";
    /** Called once when a drag or a key press ends — the moment to persist. */
    onCommit?: (size: number) => void;
    "aria-label": string;
  } = $props();

  const vertical = $derived(edge === "top" || edge === "bottom");
  /** +1 when moving towards larger coordinates grows the pane. */
  const direction = $derived(edge === "bottom" || edge === "right" ? 1 : -1);
  let dragging = $state(false);

  const clamp = (value: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

  function startDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const origin = vertical ? event.clientY : event.clientX;
    const startSize = size;
    dragging = true;
    // Captured: the pointer leaves the 6px handle on the first move, and may
    // pass over an iframe or the canvas, which would swallow the events.
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const delta = (vertical ? moveEvent.clientY : moveEvent.clientX) - origin;
      size = clamp(startSize + delta * direction);
    };
    const stop = () => {
      dragging = false;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      onCommit?.(size);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function handleKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    const towardsLarger = vertical ? "ArrowDown" : "ArrowRight";
    const towardsSmaller = vertical ? "ArrowUp" : "ArrowLeft";
    let next: number;
    if (event.key === towardsLarger) next = size + step * direction;
    else if (event.key === towardsSmaller) next = size - step * direction;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    size = clamp(next);
    onCommit?.(size);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  tabindex="0"
  aria-orientation={vertical ? "horizontal" : "vertical"}
  aria-valuenow={size}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-label={ariaLabel}
  class={`group relative z-[1] shrink-0 touch-none select-none bg-border outline-hidden transition-colors duration-fast
    hover:bg-primary focus-visible:bg-primary
    ${vertical ? "h-px w-full cursor-row-resize" : "h-full w-px cursor-col-resize"} ${dragging ? "!bg-primary" : ""}`}
  onpointerdown={startDrag}
  onkeydown={handleKeyDown}
>
  <!-- The line is 1px; this is the 7px it can actually be grabbed by. -->
  <span class={`absolute ${vertical ? "inset-x-0 -top-[3px] h-[7px]" : "inset-y-0 -left-[3px] w-[7px]"}`}></span>
</div>
