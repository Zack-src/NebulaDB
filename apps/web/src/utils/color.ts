/**
 * Whether text on `background` should be dark.
 *
 * Uses WCAG relative luminance (with the sRGB gamma expansion), not a naive
 * channel average: the average calls mid-yellow "dark" and puts white text on
 * it. Table header colours come from an open palette plus a free hex field, so
 * the foreground genuinely has to be computed rather than assumed.
 */
export function prefersDarkText(background: string): boolean {
  const rgb = parseHex(background);
  if (!rgb) return false;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  return luminance > 0.42;
}

/** `#rgb` / `#rrggbb` -> channel triple. Anything else (a gradient, a named colour) returns null and the caller keeps its default. */
function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) {
    const [r, g, b] = hex.split("");
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  if (hex.length === 6) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return null;
}
