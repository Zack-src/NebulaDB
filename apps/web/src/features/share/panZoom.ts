/**
 * Pan and zoom of the shared diagram: a translation then a uniform scale of
 * the picture inside its frame (`transform-origin: 0 0`). Pure, so the
 * arithmetic is tested without a browser.
 */

export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The whole picture centred in the frame, never enlarged past its own size. */
export function fitView(content: Size, frame: Size, padding = 24): View {
  if (content.width <= 0 || content.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = clampScale(
    Math.min((frame.width - 2 * padding) / content.width, (frame.height - 2 * padding) / content.height, 1),
  );
  return {
    x: (frame.width - content.width * scale) / 2,
    y: (frame.height - content.height * scale) / 2,
    scale,
  };
}

/** Zooms by `factor` keeping `point` (in frame coordinates) where it is — under the pointer, or the frame's centre. */
export function zoomAt(view: View, factor: number, point: { x: number; y: number }): View {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return { x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio, scale };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** The size an SVG document says it has (`width`/`height` on its root, else its `viewBox`); `null` if it says neither. */
export function svgSize(svg: string): Size | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}="([\\d.]+)"`).exec(root)?.[1];
  const width = Number(attribute("width"));
  const height = Number(attribute("height"));
  if (width > 0 && height > 0) return { width, height };
  const viewBox = /\sviewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(root);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  return null;
}
