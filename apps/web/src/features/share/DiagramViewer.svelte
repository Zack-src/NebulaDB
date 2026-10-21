<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fitView, panBy, svgSize, zoomAt, type Size, type View } from "./panZoom";

  /**
   * The shared diagram: the server's SVG rendering of the schema, panned and
   * zoomed. Not the editor's canvas — that one is built on the live Yjs
   * document, its awareness and its editing state; this page has none of
   * them and should load none of them. Shown as an `<img>` of a blob, so the
   * document cannot run anything even if a name in it tried to.
   */
  let { svg, name }: { svg: string; name: string } = $props();

  const { t } = useTranslation();
  const ZOOM_STEP = 1.25;
  const PAN_STEP = 60;

  let frame = $state<HTMLDivElement>();
  let frameSize = $state<Size>({ width: 0, height: 0 });
  let view = $state<View>({ x: 0, y: 0, scale: 1 });
  let fitted = false;
  const content = $derived(svgSize(svg) ?? { width: 800, height: 600 });

  let url = $state<string | null>(null);
  $effect(() => {
    const current = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    url = current;
    return () => URL.revokeObjectURL(current);
  });

  function fit() {
    view = fitView(content, frameSize);
  }
  const centre = () => ({ x: frameSize.width / 2, y: frameSize.height / 2 });

  $effect(() => {
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      frameSize = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (!fitted && frameSize.width > 0) {
        fitted = true;
        fit();
      }
    });
    observer.observe(frame);
    // Not `onwheel`: the page must not scroll under a zoom, which a passive listener cannot prevent.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = frame!.getBoundingClientRect();
      view = zoomAt(view, Math.exp(-event.deltaY * 0.0015), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };
    frame.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      frame?.removeEventListener("wheel", wheel);
    };
  });

  let dragging: { id: number; x: number; y: number } | null = null;
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    frame?.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent) {
    if (!dragging || dragging.id !== event.pointerId) return;
    view = panBy(view, event.clientX - dragging.x, event.clientY - dragging.y);
    dragging = { ...dragging, x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: PointerEvent) {
    if (dragging?.id === event.pointerId) dragging = null;
  }

  function onKeyDown(event: KeyboardEvent) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [PAN_STEP, 0],
      ArrowRight: [-PAN_STEP, 0],
      ArrowUp: [0, PAN_STEP],
      ArrowDown: [0, -PAN_STEP],
    };
    if (event.key in moves) view = panBy(view, ...moves[event.key]);
    else if (event.key === "+" || event.key === "=") view = zoomAt(view, ZOOM_STEP, centre());
    else if (event.key === "-") view = zoomAt(view, 1 / ZOOM_STEP, centre());
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
  }
</script>

<div class="relative min-h-0 flex-1 overflow-hidden bg-surface-hover/40">
  <!-- Focusable so the arrows and + / − work from the keyboard; the buttons below do the same with a pointer. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={frame}
    class="absolute inset-0 cursor-grab touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
    role="application"
    aria-roledescription={t("share.diagramRole")}
    aria-label={t("share.diagramLabel", { name })}
    tabindex="0"
    data-testid="share-diagram"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onkeydown={onKeyDown}
  >
    {#if url}
      <img
        src={url}
        alt=""
        draggable="false"
        class="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left rounded-md shadow-sm"
        style:width="{content.width}px"
        style:height="{content.height}px"
        style:transform="translate({view.x}px, {view.y}px) scale({view.scale})"
      />
    {/if}
  </div>
  <div class="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-sm">
    <Button size="xs" variant="ghost" aria-label={t("share.zoomOut")} onclick={() => (view = zoomAt(view, 1 / ZOOM_STEP, centre()))}
      >−</Button
    >
    <span class="w-12 text-center text-[11px] tabular-nums text-text-muted">{Math.round(view.scale * 100)} %</span>
    <Button size="xs" variant="ghost" aria-label={t("share.zoomIn")} onclick={() => (view = zoomAt(view, ZOOM_STEP, centre()))}
      >+</Button
    >
    <Button size="xs" variant="ghost" onclick={fit}>{t("share.fit")}</Button>
  </div>
</div>
