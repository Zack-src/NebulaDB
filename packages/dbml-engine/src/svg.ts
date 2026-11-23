import type { Field, Project, Ref, Table, Zone } from "@nebuladb/shared";

// Own module, same reasoning as serialize.ts: zero `@dbml/core` import, so
// pulling in SVG export never drags the parser along for a caller (the
// server's `/api/v1` export route) that only wants a rendering of what's
// already on the canvas.

/**
 * Deterministic, server-side SVG rendering of a project's schema from the stored
 * `Table.position`/`.size`, with no browser, for `/api/v1` callers (CI, scripts). A simple schema
 * diagram, not a pixel copy of the canvas; the app's own PNG/SVG export (`canvasImageExport.ts`)
 * renders the real DOM.
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
  /** The canvas's own default for a zone (`ZoneNode.svelte`). */
  zone: "#f59e0b",
  darkText: "#0f172a",
} as const;

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` — anything else from a hand-written document is ignored, never interpolated. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A colour from the document, if it is one the SVG can take as is. */
function safeColor(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : null;
}

/** `#rrggbb` from any accepted hex form (alpha dropped): what a contrast check and a tint need. */
function toRrggbb(color: string): string {
  const hex = color.slice(1);
  const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((c) => c + c).join("") : hex.slice(0, 6);
  return `#${full.toLowerCase()}`;
}

/** Dark text on a light background, as the canvas does (`prefersDarkText`, relative luminance > 0.42). */
function prefersDarkText(background: string): boolean {
  const hex = toRrggbb(background).slice(1);
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) > 0.42;
}

/** Anything a hand-written document puts where text belongs (a number, an object, nothing) is text before it is escaped. */
function escapeXml(value: unknown): string {
  return (typeof value === "string" ? value : value == null || typeof value === "object" ? "" : String(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Position and size come from the stored document, which an editor can write by hand: anything but a
 * finite number would otherwise be interpolated unescaped into an attribute (`x="${x}"`).
 */
function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeTable(table: Table): Table {
  return {
    ...table,
    position: { x: finite(table.position?.x, 0), y: finite(table.position?.y, 0) },
    size: table.size
      ? { width: finite(table.size.width, DEFAULT_WIDTH), height: finite(table.size.height, HEADER_HEIGHT) }
      : table.size,
  };
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
  const text = (value: unknown) =>
    typeof value === "string" ? value : value == null || typeof value === "object" ? "" : String(value);
  const label = `${text(field.name)} : ${text(field.type)}`;
  return flags.length > 0 ? `${label} [${flags.join(", ")}]` : label;
}

function renderTable(table: Table): string {
  const x = table.position.x;
  const y = table.position.y;
  const width = tableWidth(table);
  const height = tableHeight(table);
  // The header colour and the border chosen on the canvas.
  const headerFill = safeColor(table.style?.color) ?? COLORS.headerFill;
  const headerText = safeColor(table.style?.color) && prefersDarkText(headerFill) ? COLORS.darkText : COLORS.headerText;
  const stroke = safeColor(table.style?.borderColor) ?? COLORS.tableStroke;

  const rows = table.fields
    .map((field, i) => {
      const rowY = HEADER_HEIGHT + i * ROW_HEIGHT;
      const textColor = field.pk ? COLORS.pkText : COLORS.rowText;
      return `<text x="${x + 10}" y="${y + rowY + ROW_HEIGHT / 2 + 4}" font-size="12" fill="${textColor}">${escapeXml(fieldLabel(field))}</text>`;
    })
    .join("\n    ");

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${COLORS.tableFill}" stroke="${stroke}" stroke-width="1.5" rx="4" />
    <rect x="${x}" y="${y}" width="${width}" height="${HEADER_HEIGHT}" fill="${headerFill}" rx="4" />
    <rect x="${x}" y="${y + HEADER_HEIGHT - 4}" width="${width}" height="4" fill="${headerFill}" />
    <text x="${x + 10}" y="${y + HEADER_HEIGHT / 2 + 4}" font-size="13" font-weight="bold" fill="${headerText}">${escapeXml(table.name)}</text>
    ${rows}
  </g>`;
}

/** Center of a table's bounding box — refs are drawn edge-to-edge from here, not from a specific field row, keeping the layout independent of field count/order. */
function tableCenter(table: Table): { x: number; y: number } {
  return { x: table.position.x + tableWidth(table) / 2, y: table.position.y + tableHeight(table) / 2 };
}

/** [label at `from`, label at `to`] — `from` is the foreign-key (many) side, same as the canvas. */
const CARDINALITY_LABEL: Record<Ref["cardinality"], [string, string]> = {
  "one-to-one": ["1", "1"],
  "one-to-many": ["n", "1"],
  "many-to-many": ["n", "n"],
};

function renderRef(ref: Ref, tablesById: Map<string, Table>): string | null {
  const fromTable = tablesById.get(ref.from.tableId);
  const toTable = tablesById.get(ref.to.tableId);
  if (!fromTable || !toTable) return null; // dangling ref — table since deleted

  const from = tableCenter(fromTable);
  const to = tableCenter(toTable);
  // A cardinality the document made up is drawn without labels rather than failing the whole export.
  const [fromLabel, toLabel] = CARDINALITY_LABEL[ref.cardinality] ?? ["", ""];
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  const line = safeColor(ref.style?.color) ?? COLORS.refLine;
  return `
  <g>
    <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${line}" stroke-width="1.5" />
    <text x="${from.x + (midX - from.x) * 0.15}" y="${from.y + (midY - from.y) * 0.15 - 4}" font-size="10" fill="${COLORS.refLabel}">${fromLabel}</text>
    <text x="${to.x + (midX - to.x) * 0.15}" y="${to.y + (midY - to.y) * 0.15 - 4}" font-size="10" fill="${COLORS.refLabel}">${toLabel}</text>
  </g>`;
}

function sanitizeZone(zone: Zone): Zone {
  return {
    ...zone,
    position: { x: finite(zone.position?.x, 0), y: finite(zone.position?.y, 0) },
    size: { width: Math.max(finite(zone.size?.width, 0), 0), height: Math.max(finite(zone.size?.height, 0), 0) },
  };
}

/** A zone as the canvas draws it: a tinted, dashed-bordered area with its label at the top left. */
function renderZone(zone: Zone): string {
  const { x, y } = zone.position;
  const { width, height } = zone.size;
  const color = toRrggbb(safeColor(zone.style?.color) ?? COLORS.zone);
  const border = safeColor(zone.style?.borderColor) ?? color;
  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.12" stroke="${border}" stroke-width="1.5" stroke-dasharray="6 4" rx="8" />
    <text x="${x + 12}" y="${y + 20}" font-size="13" font-weight="bold" fill="${color}">${escapeXml(zone.label)}</text>
  </g>`;
}

/**
 * Renders a project's schema as a self-contained SVG document: the zones (behind everything), the
 * refs as lines with cardinality labels, the tables and their columns — with the colours chosen on
 * the canvas (table header and border, ref, zone). Sticky notes and table groups aren't drawn.
 * An empty project renders a fixed-size empty canvas rather than throwing.
 */
export function projectToSvg(source: Project): string {
  const project = {
    ...source,
    tables: source.tables.map(sanitizeTable),
    zones: (Array.isArray(source.zones) ? source.zones : []).map(sanitizeZone),
  };
  const tablesById = new Map(project.tables.map((t) => [t.id, t]));

  if (project.tables.length === 0 && project.zones.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="${COLORS.background}" /></svg>`;
  }

  const boxes = [
    ...project.tables.map((t) => ({ ...t.position, width: tableWidth(t), height: tableHeight(t) })),
    ...project.zones.map((z) => ({ ...z.position, ...z.size })),
  ];
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));

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
  const zonesSvg = project.zones.map((zone) => renderZone(zone)).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect width="${width}" height="${height}" fill="${COLORS.background}" />
  <g transform="translate(${offsetX}, ${offsetY})">
    ${zonesSvg}
    ${refsSvg}
    ${tablesSvg}
  </g>
</svg>`;
}
