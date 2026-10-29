import type { LocalTable } from "@/features/palette/paletteModel";

/**
 * What the global palette may ask of the project being edited: its tables, read
 * lazily so a keystroke in the DBML never rebuilds a list nobody is looking
 * at, and a way to centre the canvas on one.
 *
 * Stated by the editor once per project, like `commentsSession` — the palette
 * lives in the app shell, far above the editor that owns the document.
 */
export interface OpenProjectSource {
  projectId: string;
  tables: () => LocalTable[];
  openTable: (tableName: string, fieldName?: string) => void;
}

let current: OpenProjectSource | null = null;

export const openProjectSource = {
  set(next: OpenProjectSource | null): void {
    current = next;
  },
  get(): OpenProjectSource | null {
    return current;
  },
};
