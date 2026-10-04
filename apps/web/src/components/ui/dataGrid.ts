/**
 * The parts of `DataGrid.svelte` that are arithmetic, not markup: how cells
 * compare, which rows are in view, how wide a column may be. Kept apart so
 * they can be tested without a browser.
 */

export type SortDirection = "asc" | "desc";

export interface GridSort {
  /** Index into the grid's columns. */
  column: number;
  direction: SortDirection;
}

/** A click on a header walks ascending → descending → unsorted; another column starts over. */
export function nextSort(current: GridSort | null, column: number): GridSort | null {
  if (!current || current.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

/** What `aria-sort` says for a column. */
export function ariaSort(sort: GridSort | null, column: number): "ascending" | "descending" | "none" {
  if (!sort || sort.column !== column) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

/**
 * The text of a cell. `null` is returned for SQL NULL so the caller can show
 * it as such; a nested value (a JSON column the driver already parsed) is
 * printed as JSON rather than as "[object Object]".
 */
export function formatCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Big integers and decimals reach the grid as strings: they still sort as numbers. */
const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const RANK_NUMBER = 0;
const RANK_TEXT = 1;
const RANK_NULL = 2;

interface SortKey {
  rank: number;
  number: number;
  text: string;
}

function sortKey(value: unknown): SortKey {
  if (value === null || value === undefined) return { rank: RANK_NULL, number: 0, text: "" };
  if (typeof value === "number" && !Number.isNaN(value)) return { rank: RANK_NUMBER, number: value, text: "" };
  if (typeof value === "bigint") return { rank: RANK_NUMBER, number: Number(value), text: "" };
  if (typeof value === "string" && NUMERIC_TEXT.test(value.trim())) {
    return { rank: RANK_NUMBER, number: Number(value), text: "" };
  }
  return { rank: RANK_TEXT, number: 0, text: formatCell(value) ?? "" };
}

const collator = new Intl.Collator(undefined, { sensitivity: "variant" });

function compareKeys(a: SortKey, b: SortKey, direction: SortDirection): number {
  // NULL is last whichever way the column is sorted: it is the absence of a
  // value, not the smallest one.
  if (a.rank === RANK_NULL || b.rank === RANK_NULL) return a.rank === b.rank ? 0 : a.rank === RANK_NULL ? 1 : -1;
  let order: number;
  if (a.rank !== b.rank) order = a.rank - b.rank;
  else if (a.rank === RANK_NUMBER) order = a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  else order = collator.compare(a.text, b.text);
  return direction === "asc" ? order : -order;
}

/**
 * Orders two cells: numbers (and numeric text) by value and before any other
 * text, text by the locale's alphabet, NULL after everything in both
 * directions.
 */
export function compareCells(a: unknown, b: unknown, direction: SortDirection = "asc"): number {
  return compareKeys(sortKey(a), sortKey(b), direction);
}

/**
 * The order in which to show `rows`: indices into the array, which is left
 * untouched. Rows that compare equal keep the order they were given in.
 */
export function sortedRowOrder(rows: readonly (readonly unknown[])[], sort: GridSort | null): number[] {
  const order = rows.map((_, index) => index);
  if (!sort) return order;
  const keys = rows.map((row) => sortKey(row[sort.column]));
  return order.sort((a, b) => compareKeys(keys[a], keys[b], sort.direction) || a - b);
}

export interface VisibleRangeInput {
  scrollTop: number;
  /** Height of the area the rows scroll in, the sticky header excluded. */
  viewportHeight: number;
  rowHeight: number;
  rowCount: number;
  /** Rows rendered beyond each edge, so a fast scroll does not show a blank band. */
  overscan: number;
}

/** The rows to put in the DOM: `start` inclusive, `end` exclusive. */
export function visibleRange(input: VisibleRangeInput): { start: number; end: number } {
  const { rowHeight, rowCount } = input;
  if (rowCount <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const overscan = Math.max(0, Math.floor(input.overscan));
  const top = Math.max(0, input.scrollTop);
  const first = Math.min(rowCount - 1, Math.floor(top / rowHeight));
  const last = Math.min(rowCount - 1, Math.floor((top + Math.max(0, input.viewportHeight)) / rowHeight));
  return { start: Math.max(0, first - overscan), end: Math.min(rowCount, last + 1 + overscan) };
}

export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 1200;
/** A column sizes itself to its content up to this; wider is the user's choice. */
export const MAX_AUTO_COLUMN_WIDTH = 320;

export function clampWidth(width: number, min = MIN_COLUMN_WIDTH, max = MAX_COLUMN_WIDTH): number {
  if (!Number.isFinite(width)) return min;
  return Math.round(Math.min(Math.max(width, min), Math.max(min, max)));
}

export interface AutoWidthOptions {
  /** Width of one character of the grid's monospace font. */
  charWidth: number;
  /** Horizontal padding of a cell plus what the header adds (sort mark, resize handle). */
  chrome: number;
  /** Only the first rows are measured: the width has to be known before the rest is looked at. */
  sampleSize?: number;
  nullLabel?: string;
}

/** A width that shows a column's header and its first rows without cutting them, within the automatic bounds. */
export function autoColumnWidth(
  header: string,
  rows: readonly (readonly unknown[])[],
  column: number,
  options: AutoWidthOptions,
): number {
  const nullLength = (options.nullLabel ?? "NULL").length;
  const sample = Math.min(rows.length, options.sampleSize ?? 200);
  let longest = header.length;
  for (let index = 0; index < sample; index += 1) {
    const text = formatCell(rows[index][column]);
    const length = text === null ? nullLength : text.length;
    if (length > longest) longest = length;
    // Past the cap nothing more can be learnt from the remaining rows.
    if (longest * options.charWidth + options.chrome >= MAX_AUTO_COLUMN_WIDTH) break;
  }
  return clampWidth(Math.ceil(longest * options.charWidth + options.chrome), MIN_COLUMN_WIDTH, MAX_AUTO_COLUMN_WIDTH);
}

/** The caller's widths where it gave a usable one, the automatic width elsewhere. */
export function resolveWidths(automatic: readonly number[], given: readonly number[] | undefined): number[] {
  return automatic.map((fallback, index) => {
    const width = given?.[index];
    return typeof width === "number" && Number.isFinite(width) ? clampWidth(width) : fallback;
  });
}

/**
 * Where a key pressed on the grid scrolls to, or `null` when the key is not a
 * scrolling one. Steps are whole rows, so a row is never left half under the
 * header.
 */
export function scrollTopForKey(
  key: string,
  state: { scrollTop: number; viewportHeight: number; rowHeight: number; rowCount: number },
): number | null {
  const { rowHeight } = state;
  const max = Math.max(0, state.rowCount * rowHeight - state.viewportHeight);
  const page = Math.max(rowHeight, Math.floor(state.viewportHeight / rowHeight - 1) * rowHeight);
  let target: number;
  if (key === "ArrowDown") target = state.scrollTop + rowHeight;
  else if (key === "ArrowUp") target = state.scrollTop - rowHeight;
  else if (key === "PageDown") target = state.scrollTop + page;
  else if (key === "PageUp") target = state.scrollTop - page;
  else if (key === "Home") target = 0;
  else if (key === "End") target = max;
  else return null;
  return Math.min(max, Math.max(0, target));
}
