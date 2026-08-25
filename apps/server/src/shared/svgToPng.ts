import sharp from "sharp";

/**
 * Rasterises an SVG string to PNG. Lives here rather than in
 * `dbml-engine/src/svg.ts` deliberately: `sharp` is a native, server-only
 * dependency (libvips), and `dbml-engine` is shared with the browser bundle
 * — pulling a native binary into that package would break the web build.
 * Used only by the `/api/v1` PNG export route.
 */
export async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
}
