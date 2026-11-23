import type { Node, Rect } from "@xyflow/svelte";
import type { CanvasExportHandle } from "@/types";

const VIEWPORT_SELECTOR = ".svelte-flow__viewport";
const EXPORT_BACKGROUND = "#17181b";
/** Space around the diagram, in canvas pixels. */
const EXPORT_PADDING = 48;
/** Device pixels per canvas pixel for a raster export: sharp when zoomed in, as on a high-DPI screen. */
const TARGET_PIXEL_RATIO = 2;
/**
 * Browsers refuse a canvas beyond a size (Chrome: 16384 px a side, ~268 M pixels; Safari less), and
 * a huge one costs a lot of memory: a very large diagram is exported at a lower ratio rather than
 * failing.
 */
const MAX_SIDE_PX = 16_000;
const MAX_AREA_PX = 120_000_000;
/** Below this the text is no longer readable anyway; the export still happens, just smaller. */
const MIN_PIXEL_RATIO = 0.25;

/**
 * The device-pixel ratio a raster export of `width` × `height` canvas pixels can use: the target,
 * lowered until the image fits the browser's canvas limits.
 */
export function exportPixelRatio(width: number, height: number): number {
  const ratio = Math.min(
    TARGET_PIXEL_RATIO,
    MAX_SIDE_PX / width,
    MAX_SIDE_PX / height,
    Math.sqrt(MAX_AREA_PX / (width * height)),
  );
  return Math.max(MIN_PIXEL_RATIO, ratio);
}

/** The area to export around the diagram's bounds, in canvas pixels (whole numbers). */
export function exportFrame(bounds: Rect): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.floor(bounds.x - EXPORT_PADDING),
    y: Math.floor(bounds.y - EXPORT_PADDING),
    width: Math.ceil(bounds.width + 2 * EXPORT_PADDING),
    height: Math.ceil(bounds.height + 2 * EXPORT_PADDING),
  };
}

/**
 * Builds the imperative capture handle for the export dialog. It has to be imperative: the dialog
 * lives outside the canvas, so it has no other way to reach the flow.
 *
 * The whole diagram is rendered at its own size (zoom 1), whatever the screen shows: the flow's
 * viewport element is cloned with a transform that puts the diagram's bounds at the origin, so
 * neither the window's size nor the user's zoom limits the result — fitting a large diagram into
 * the window made its text a few pixels high. Nothing on the live canvas moves (every node is in
 * the DOM: the canvas renders them all, `onlyRenderVisibleElements={false}`).
 */
export function createCanvasImageExport<N extends Node>(flow: {
  getNodes: () => N[];
  getNodesBounds: (nodes: N[]) => Rect;
}): CanvasExportHandle {
  return {
    capture: async (format) => {
      const viewport = document.querySelector(VIEWPORT_SELECTOR) as HTMLElement | null;
      if (!viewport) throw new Error("canvas is not ready yet");
      const nodes = flow.getNodes();
      const bounds = nodes.length > 0 ? flow.getNodesBounds(nodes) : { x: 0, y: 0, width: 400, height: 300 };
      const frame = exportFrame(bounds);
      // html-to-image is only needed for this one action — a dynamic import
      // keeps it out of the bundle everyone loads just to view a diagram.
      const { toPng, toSvg } = await import("html-to-image");
      const options = {
        backgroundColor: EXPORT_BACKGROUND,
        width: frame.width,
        height: frame.height,
        // SVG is vector: its size is the canvas's, sharp at any zoom.
        pixelRatio: format === "png" ? exportPixelRatio(frame.width, frame.height) : 1,
        style: {
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          transform: `translate(${-frame.x}px, ${-frame.y}px) scale(1)`,
        },
      };
      const dataUrl = format === "png" ? await toPng(viewport, options) : await toSvg(viewport, options);
      return { dataUrl, width: frame.width, height: frame.height };
    },
  };
}
