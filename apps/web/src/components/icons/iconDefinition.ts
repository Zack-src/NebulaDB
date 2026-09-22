/** A parsed `.svg` file: its root attributes (viewBox, fill, stroke…) and inner markup, plus the size the icon renders at by default. */
export interface IconDefinition {
  attributes: Record<string, string>;
  body: string;
  defaultSize: number;
}

const ROOT = /^\s*<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i;
const ATTRIBUTE = /([\w:-]+)\s*=\s*"([^"]*)"/g;
/** Attributes `Icon.svelte` sets itself — width/height come from `size`, the namespace from the `<svg>` element. */
const OWNED = new Set(["width", "height", "xmlns"]);

/**
 * Parsed once, at module load — every render after that only spreads the
 * pre-split attributes and injects the pre-extracted body, so an icon costs
 * no more than the hand-written `<svg>` it replaces.
 */
export function defineIcon(raw: string, defaultSize: number): IconDefinition {
  const match = ROOT.exec(raw);
  if (!match) throw new Error("icon: not an <svg> document");
  const attributes: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(ATTRIBUTE)) {
    if (!OWNED.has(name)) attributes[name] = value;
  }
  return { attributes, body: match[2].trim(), defaultSize };
}
