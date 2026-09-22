import type { Viewport } from "@xyflow/svelte";
import type { CanvasExportHandle } from "@/types";

const PANE_SELECTOR = ".svelte-flow__pane";
const EXPORT_BACKGROUND = "#17181b";
const EXPORT_FIT_PADDING = 0.15;
const PNG_PIXEL_RATIO = 2;
/** Cap on how long the export waits for `fitView` to settle before capturing anyway. */
const FIT_TIMEOUT_MS = 1000;

/**
 * Builds the imperative capture handle for the export dialog.
 *
 * It has to be imperative: the dialog lives outside the canvas, so it has no
 * other way to reach `fitView`/`getViewport`.
 */
export function createCanvasImageExport(flow: {
  fitView: (options?: { padding?: number; duration?: number }) => Promise<boolean>;
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport, options?: { duration?: number }) => Promise<boolean>;
}): CanvasExportHandle {
  return {
    capture: async (format) => {
      const pane = document.querySelector(PANE_SELECTOR) as HTMLElement | null;
      if (!pane) throw new Error("canvas is not ready yet");
      const previousViewport = flow.getViewport();
      // Fit the *entire* diagram into the current pane size first — reuses the
      // flow's own (already correct) fit logic instead of hand-rolling
      // bounds/zoom math, and means the export isn't just whatever happens to
      // be on-screen from the user's last pan/zoom.
      //
      // `fitView`'s promise only settles once the nodes report measured
      // dimensions — on an empty diagram it may never settle at all, so it is
      // raced against a timeout rather than awaited outright, which would hang
      // the dialog forever. The two animation frames afterwards let the
      // viewport update reach the DOM.
      await Promise.race([
        flow.fitView({ padding: EXPORT_FIT_PADDING, duration: 0 }),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), FIT_TIMEOUT_MS)),
      ]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const width = pane.clientWidth;
      const height = pane.clientHeight;
      try {
        // html-to-image is only needed for this one action — a dynamic import
        // keeps it out of the bundle everyone loads just to view a diagram.
        const { toPng, toSvg } = await import("html-to-image");
        const options = {
          backgroundColor: EXPORT_BACKGROUND,
          width,
          height,
          pixelRatio: format === "png" ? PNG_PIXEL_RATIO : 1,
        };
        const dataUrl = format === "png" ? await toPng(pane, options) : await toSvg(pane, options);
        return { dataUrl, width, height };
      } finally {
        void flow.setViewport(previousViewport, { duration: 0 });
      }
    },
  };
}
