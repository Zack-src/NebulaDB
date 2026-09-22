import type { Field, Project, Ref, Table } from "@athanordb/shared";

// Own module, same reasoning as serialize.ts: zero `@dbml/core` import, so
// pulling in SVG export never drags the parser along for a caller (the
// server's `/api/v1` export route) that only wants a rendering of what's
// already on the canvas.

/**
 * Deterministic, server-side SVG rendering of a project's schema, built
 * directly from the layout data already stored on `Table.position`/`.size`
 * — no browser involved. This deliberately does not attempt to reproduce the
 * live canvas pixel-for-pixel (React Flow's own styling, in
 * `apps/web/src/features/editor/nodes/TableNode.tsx`, is not duplicated
 * here): the app's own PNG/SVG export
 * (`apps/web/.../useCanvasImageExport.ts`) already does that from the real
 * DOM for anyone using the app. This renderer exists so `/api/v1` callers
 * (CI, scripts) can get a diagram without driving a browser — a fast, simple
 * schema, not a canvas screenshot.
 */

const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;
const DEFAULT_WIDTH = 220;
const PADDING = 40;

const COLORS = {
  background: "#ffffff",
  tableFill: "#ffffff",
  tableStroke: "#94a3b8",
  headerFill: "#1e293b",
  headerText: "#f8fafc",
  rowText: "#0f172a",
  rowTextMuted: "#64748b",
  pkText: "#b45309",
  refLine: "#94a3b8",
  refLabel: "#64748b",
} as const;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tableHeight(table: Table): number {
  return table.size?.height ?? HEADER_HEIGHT + Math.max(table.fields.length, 1) * ROW_HEIGHT;
}

function tableWidth(table: Table): number {
  return table.size?.width ?? DEFAULT_WIDTH;
}

function fieldLabel(field: Field): string {
  const flags = [field.pk ? "pk" : null, field.unique ? "unique" : null, field.notNull ? "not null" : null].filter(
    Boolean,
  );
  return flags.length > 0 ? `${field.name} : ${field.type} [${flags.join(", ")}]` : `${field.name} : ${field.type}`;
}

function renderTable(table: Table): string {
  const x = table.position.x;
  const y = table.position.y;
  const width = tableWidth(table);
  const height = tableHeight(table);

  const rows = table.fields
    .map((field, i) => {
      const rowY = HEADER_HEIGHT + i * ROW_HEIGHT;
      const textColor = field.pk ? COLORS.pkText : COLORS.rowText;
      return `<text x="${x + 10}" y="${y + rowY + ROW_HEIGHT / 2 + 4}" font-size="12" fill="${textColor}">${escapeXml(fieldLabel(field))}</text>`;
    })
    .join("\n    ");

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${COLORS.tableFill}" stroke="${COLORS.tableStroke}" stroke-width="1.5" rx="4" />
    <rect x="${x}" y="${y}" width="${width}" height="${HEADER_HEIGHT}" fill="${COLORS.headerFill}" rx="4" />
    <rect x="${x}" y="${y + HEADER_HEIGHT - 4}" width="${width}" height="4" fill="${COLORS.headerFill}" />
    <text x="${x + 10}" y="${y + HEADER_HEIGHT / 2 + 4}" font-size="13" font-weight="bold" fill="${COLORS.headerText}">${escapeXml(table.name)}</text>
    ${rows}
  </g>`;
}

/** Center of a table's bounding box — refs are drawn edge-to-edge from here, not from a specific field row, keeping the layout independent of field count/order. */
function tableCenter(table: Table): { x: number; y: number } {
  return { x: table.position.x + tableWidth(table) / 2, y: table.position.y + tableHeight(table) / 2 };
}

const CARDINALITY_LABEL: Record<Ref["cardinality"], [string, string]> = {
  "one-to-one": ["1", "1"],
  "one-to-many": ["1", "n"],
  "many-to-many": ["n", "n"],
};

function renderRef(ref: Ref, tablesById: Map<string, Table>): string | null {
  const fromTable = tablesById.get(ref.from.tableId);
  const toTable = tablesById.get(ref.to.tableId);
  if (!fromTable || !toTable) return null; // dangling ref — table since deleted

  const from = tableCenter(fromTable);
  const to = tableCenter(toTable);
  const [fromLabel, toLabel] = CARDINALITY_LABEL[ref.cardinality];
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  return `
  <g>
    <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${COLORS.refLine}" stroke-width="1.5" />
    <text x="${from.x + (midX - from.x) * 0.15}" y="${from.y + (midY - from.y) * 0.15 - 4}" font-size="10" fill="${COLORS.refLabel}">${fromLabel}</text>
    <text x="${to.x + (midX - to.x) * 0.15}" y="${to.y + (midY - to.y) * 0.15 - 4}" font-size="10" fill="${COLORS.refLabel}">${toLabel}</text>
  </g>`;
}

/**
 * Renders a project's schema as a self-contained SVG document. Tables and
 * their columns, refs as lines with cardinality labels — zones, sticky
 * notes, and table groups aren't drawn (they're canvas organisation aids,
 * not schema structure). Empty project renders a fixed-size empty canvas
 * rather than throwing.
 */
export function projectToSvg(project: Project): string {
  const tablesById = new Map(project.tables.map((t) => [t.id, t]));

  if (project.tables.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="${COLORS.background}" /></svg>`;
  }

  const minX = Math.min(...project.tables.map((t) => t.position.x));
  const minY = Math.min(...project.tables.map((t) => t.position.y));
  const maxX = Math.max(...project.tables.map((t) => t.position.x + tableWidth(t)));
  const maxY = Math.max(...project.tables.map((t) => t.position.y + tableHeight(t)));

  const width = maxX - minX + PADDING * 2;
  const height = maxY - minY + PADDING * 2;
  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;

  // Refs are drawn first so table boxes render on top of the connecting lines, not under them.
  const refsSvg = project.refs
    .map((ref) => renderRef(ref, tablesById))
    .filter(Boolean)
    .join("\n");
  const tablesSvg = project.tables.map((table) => renderTable(table)).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect width="${width}" height="${height}" fill="${COLORS.background}" />
  <g transform="translate(${offsetX}, ${offsetY})">
    ${refsSvg}
    ${tablesSvg}
  </g>
</svg>`;
}
