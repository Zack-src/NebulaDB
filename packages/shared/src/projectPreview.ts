import type { Project, Table } from "./schema.js";

/**
 * A light picture of a project, small enough to be drawn before the application has even started: the
 * first lines of its DBML and a box and a line for each table and relation, placed where the real canvas
 * will place them. `GET /api/projects/:id/preview` serves it, and `index.html` paints it while the editor
 * loads; the editor takes over from it once its own canvas is up.
 */

/** How many lines of DBML the picture carries: more than fit on a screen, far fewer than the whole schema. */
export const PREVIEW_DBML_LINES = 80;

export interface PreviewNode {
  x: number;
  y: number;
  /** In flow units at font scale 1. */
  w: number;
  h: number;
  name: string;
  /** The header colour when the table has one of its own; the picture falls back to the editor's default. */
  color?: string;
}

export interface ProjectPreview {
  /** The first `PREVIEW_DBML_LINES` lines of the schema, exactly as the editor's DBML panel starts. */
  dbml: string;
  totalLines: number;
  nodes: PreviewNode[];
  /** Pairs of indexes into `nodes`: the table holding the foreign key and the table it points at. */
  edges: [number, number][];
}

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

export interface TableBox {
  width: number;
  height: number;
}

/** `rows`: the columns the table shows at its detail level (none when compact). */
export function estimateTableBox(table: Pick<Table, "name" | "detailLevel">, rows: readonly { name: string; type: string }[]): TableBox {
  if (table.detailLevel === "compact") return { width: MIN_WIDTH, height: HEADER };
  const longest = rows.reduce((max, field) => Math.max(max, field.name.length + 1 + field.type.length), table.name.length);
  return {
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(WIDTH_BASE + WIDTH_PER_CHAR * longest))),
    height: HEADER + ROW * rows.length + FOOTER,
  };
}

/** The columns a table shows at its detail level: all of them, none, or the keys and the foreign-key columns. */
export function visibleColumns(table: Table, refFieldIds: ReadonlySet<string>): Table["fields"] {
  if (table.detailLevel === "compact") return [];
  if (table.detailLevel === "full") return table.fields;
  const pkIndexed = new Set<string>();
  for (const index of table.indexes) if (index.pk) for (const id of index.fieldIds) pkIndexed.add(id);
  return table.fields.filter((field) => field.pk || pkIndexed.has(field.id) || refFieldIds.has(field.id));
}

export function buildProjectPreview(project: Project, dbml: string): ProjectPreview {
  const refFieldIds = new Map<string, Set<string>>();
  for (const ref of project.refs) {
    for (const end of [ref.from, ref.to]) {
      const set = refFieldIds.get(end.tableId) ?? new Set<string>();
      set.add(end.fieldId);
      refFieldIds.set(end.tableId, set);
    }
  }
  const index = new Map<string, number>();
  const nodes = project.tables.map((table, i): PreviewNode => {
    index.set(table.id, i);
    const box = table.size
      ? { width: table.size.width, height: table.size.height }
      : estimateTableBox(table, visibleColumns(table, refFieldIds.get(table.id) ?? new Set()));
    return { x: table.position.x, y: table.position.y, w: box.width, h: box.height, name: table.name, color: table.style?.color };
  });
  const edges: [number, number][] = [];
  for (const ref of project.refs) {
    const a = index.get(ref.from.tableId);
    const b = index.get(ref.to.tableId);
    if (a !== undefined && b !== undefined) edges.push([a, b]);
  }
  const lines = dbml.split("\n");
  return { dbml: lines.slice(0, PREVIEW_DBML_LINES).join("\n"), totalLines: lines.length, nodes, edges };
}
