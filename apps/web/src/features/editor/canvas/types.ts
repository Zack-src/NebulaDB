/** A position in flow space (not screen pixels) — what every canvas insert takes. */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** The four node kinds the toolbar's insert tools place — a "table" tool, a "zone" tool, and so on, Figma-style. */
export type CanvasInsertTool = "table" | "zone" | "note" | "enum";
