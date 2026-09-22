<script lang="ts">
  import { MiniMap, useSvelteFlow, type Node } from "@xyflow/svelte";
  import { MINIMAP_PAN_DURATION_MS, MINIMAP_PROPS } from "./canvasViewport.svelte";

  /**
   * The flow's minimap with the app's two extras: a smooth animated pan to
   * wherever it's clicked, and no browser context menu over it.
   *
   * The click and `pannable` are two independent gestures under the hood — a
   * plain click (no pointer movement between down/up) animates to the clicked
   * point; an actual drag is driven straight from `pannable`'s own d3-drag
   * handler for instant, 1:1 continuous panning. They don't fight each other,
   * so both can be on at once.
   */
  let { nodeColor }: { nodeColor: (node: Node) => string } = $props();

  const { setCenter, getZoom } = useSvelteFlow();

  function panToClick(event: MouseEvent) {
    const svg = (event.currentTarget as HTMLElement).querySelector("svg");
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    // The minimap's viewBox *is* flow space, so the SVG's own screen matrix
    // maps the click straight to the flow coordinate under it.
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    void setCenter(point.x, point.y, { zoom: getZoom(), duration: MINIMAP_PAN_DURATION_MS });
  }
</script>

<MiniMap {...MINIMAP_PROPS} {nodeColor} onclick={panToClick} oncontextmenu={(event) => event.preventDefault()} />
