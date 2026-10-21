import type { Table } from "@nebuladb/shared";

/**
 * The room a table takes before its columns are drawn, in flow units at font scale 1.
 *
 * A table first appears "lite" (its name only) and takes its columns back a moment later. The box it
 * reserves meanwhile is what the first fit of the viewport is computed on, so it has to be close to the
 * real thing or the graph would jump when the columns arrive.
 *
 * Height is exact: the node is a 34px header, 27px per column and a 31px footer (measured on a 132-table
 * schema: `65 + 27 × columns`, no error). Width is an estimate: it follows the longest column, and the
 * spread around the fit is about 33px on average, which is invisible at the zoom a whole schema is fitted at.
 */
const HEADER = 34;
const ROW = 27;
const FOOTER = 31;
const MIN_WIDTH = 190;
const MAX_WIDTH = 420;
/** `width ≈ 226 + 3.1 × (characters of the longest "name type" row)`, from the same measurement. */
const WIDTH_BASE = 226;
const WIDTH_PER_CHAR = 3.1;

export interface LiteSize {
  width: number;
  height: number;
}

/** `rows`: the columns the table shows at its detail level (none when compact). */
export function estimateLiteSize(table: Table, rows: readonly { name: string; type: string }[]): LiteSize {
  if (table.detailLevel === "compact") return { width: MIN_WIDTH, height: HEADER };
  const longest = rows.reduce((max, field) => Math.max(max, field.name.length + 1 + field.type.length), table.name.length);
  return {
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(WIDTH_BASE + WIDTH_PER_CHAR * longest))),
    height: HEADER + ROW * rows.length + FOOTER,
  };
}
