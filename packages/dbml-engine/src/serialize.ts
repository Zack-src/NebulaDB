import type {
  DetailLevel,
  Position,
  Project,
  Ref,
  RoutingPoint,
  Size,
  StickyNote,
  Table,
  VisualStyle,
  Zone,
} from "@athanordb/shared";
import { formatDbml } from "./format.js";

// Own module with zero `@dbml/core` import, same reasoning as diff.ts/validate.ts:
// `dbml.ts` instantiates a Parser at module scope, so importing *anything* from it
// drags the whole parser library (~11MB raw) into the bundle. The web app needs
// `projectToDbml` for its live DBML panel, so serialization lives here instead —
// going the other way (dbml.ts imports from here) is free.

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string): string {
  return IDENT_RE.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}

function quoteNoteText(note: string): string {
  return `'${note.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function formatDefault(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (/^(true|false|null)$/i.test(value)) return value.toLowerCase();
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function tableName(table: Table): string {
  return table.schemaName ? `${quoteIdent(table.schemaName)}.${quoteIdent(table.name)}` : quoteIdent(table.name);
}

const CARDINALITY_SYMBOL: Record<Ref["cardinality"], string> = {
  "one-to-one": "-",
  "one-to-many": ">",
  "many-to-many": "<>",
};

function fieldNameById(tables: Table[], tableId: string, fieldId: string): { table: string; field: string } | null {
  const table = tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  if (!table || !field) return null;
  return { table: table.name, field: field.name };
}

/**
 * A ref's stable identity across a reparse: table/field names on both ends,
 * same as `fieldNameById` resolves for the native `Ref:` line above it — a
 * ref's own `id` is never DBML-native, so it can't be used to match a ref
 * back up after a round trip the way `fieldNameById`'s result can.
 */
export function refSignature(tables: Table[], ref: Ref): string | null {
  const from = fieldNameById(tables, ref.from.tableId, ref.from.fieldId);
  const to = fieldNameById(tables, ref.to.tableId, ref.to.fieldId);
  if (!from || !to) return null;
  return `${from.table}.${from.field}->${to.table}.${to.field}`;
}

/**
 * DBML has no native field for position/color/detail-level/zones/sticky
 * notes, so a plain `.dbml` export/reimport round trip used to drop all of
 * it. `mergeProjectIntoExisting` already covers the common case (reimporting
 * into the *same* project preserves its live state by matching names) but
 * that's no help for a standalone file leaving the app and coming back into
 * a fresh project later, or being handed to someone else's instance.
 *
 * This sidecar is a single trailing `//`-comment line holding a compact JSON
 * blob, keyed by table *name* (the same stable key `mergeProjectIntoExisting`
 * already uses) — a plain comment, so any DBML/SQL tool that doesn't know
 * about it just ignores it. Opt-in on export (see `projectToDbml`'s
 * `includeVisualMetadata` option) so the live-editing DBML panel's text stays
 * clean; always attempted on import, since a pasted-in file either has it or
 * it's a harmless no-op.
 */
const VISUAL_METADATA_MARKER = "// athanordb:visual ";

export interface VisualMetadataV1 {
  tables?: Record<string, { position?: Position; size?: Size; style?: VisualStyle; detailLevel?: DetailLevel }>;
  zones?: Zone[];
  stickyNotes?: StickyNote[];
  /** Keyed by name, same reasoning as `tables` — DBML has no notion of enum position either. */
  enums?: Record<string, { position?: Position }>;
  /** Keyed by `refSignature` — a ref's `id` isn't DBML-native, so its endpoint names are the only stable handle across a reparse. Only refs actually carrying a style/routing get an entry. */
  refs?: Record<string, { style?: VisualStyle; routingPoints?: RoutingPoint[] }>;
  /** Keyed by name, same as `tables`. Only groups with a note get an entry — membership itself is already DBML-native (`TableGroup` blocks). */
  tableGroups?: Record<string, { note?: string }>;
  /** The project's own custom palette swatches, if it has one — has no per-element anchor to key by. */
  paletteColors?: string[];
}

/** Reads the sidecar visual-metadata blob out of raw DBML source, if present. Never throws — a missing or malformed marker just yields no metadata. */
export function extractVisualMetadata(source: string): VisualMetadataV1 | null {
  const line = source.split("\n").find((l) => l.startsWith(VISUAL_METADATA_MARKER));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(VISUAL_METADATA_MARKER.length));
  } catch {
    return null;
  }
}

/** Overlays sidecar visual metadata (if any) from raw DBML source onto an already-parsed `Project`, matching tables/enums/groups by name and refs by `refSignature`. */
export function applyVisualMetadata(project: Project, source: string): Project {
  const meta = extractVisualMetadata(source);
  if (!meta) return project;
  const tables = project.tables.map((table) => {
    const m = meta.tables?.[table.name];
    if (!m) return table;
    return {
      ...table,
      position: m.position ?? table.position,
      size: m.size ?? table.size,
      style: m.style ?? table.style,
      detailLevel: m.detailLevel ?? table.detailLevel,
    };
  });
  const enums = project.enums.map((enumDef) => {
    const m = meta.enums?.[enumDef.name];
    return m?.position ? { ...enumDef, position: m.position } : enumDef;
  });
  const refs = project.refs.map((ref) => {
    const key = refSignature(project.tables, ref);
    const m = key ? meta.refs?.[key] : undefined;
    if (!m) return ref;
    return { ...ref, style: m.style ?? ref.style, routingPoints: m.routingPoints ?? ref.routingPoints };
  });
  const tableGroups = project.tableGroups.map((group) => {
    const m = meta.tableGroups?.[group.name];
    return m?.note ? { ...group, note: m.note } : group;
  });
  return {
    ...project,
    tables,
    enums,
    refs,
    tableGroups,
    zones: meta.zones ?? project.zones,
    stickyNotes: meta.stickyNotes ?? project.stickyNotes,
    paletteColors: meta.paletteColors ?? project.paletteColors,
  };
}

/**
 * Convert AthanorDB's internal `Project` shape into DBML source text.
 * Round-trips table/field/index/ref/enum structure natively; pass
 * `includeVisualMetadata` to also append the sidecar comment (see above) so
 * position/color/detail-level/zones/sticky notes survive a save-to-file and
 * later reimport too.
 */
export function projectToDbml(project: Project, options?: { includeVisualMetadata?: boolean }): string {
  const parts: string[] = [];

  for (const table of project.tables) {
    const lines: string[] = [`Table ${tableName(table)} {`];

    for (const field of table.fields) {
      const settings: string[] = [];
      if (field.pk) settings.push("pk");
      if (field.unique) settings.push("unique");
      if (field.notNull) settings.push("not null");
      if (field.increment) settings.push("increment");
      if (field.default !== undefined) settings.push(`default: ${formatDefault(field.default)}`);
      if (field.note) settings.push(`note: ${quoteNoteText(field.note)}`);
      const settingsStr = settings.length ? ` [${settings.join(", ")}]` : "";
      lines.push(`  ${quoteIdent(field.name)} ${field.type}${settingsStr}`);
    }

    for (const idx of table.indexes) {
      if (idx.fieldIds.length === 0) continue;
      const cols = idx.fieldIds
        .map((fid) => table.fields.find((f) => f.id === fid)?.name)
        .filter((n): n is string => Boolean(n));
      if (cols.length === 0) continue;
      const idxSettings: string[] = [];
      if (idx.pk) idxSettings.push("pk");
      if (idx.unique) idxSettings.push("unique");
      if (idx.name) idxSettings.push(`name: ${quoteNoteText(idx.name)}`);
      const idxSettingsStr = idxSettings.length ? ` [${idxSettings.join(", ")}]` : "";
      lines.push(`\n  indexes {`, `    (${cols.join(", ")})${idxSettingsStr}`, `  }`);
    }

    if (table.note) {
      lines.push("", `  Note: ${quoteNoteText(table.note)}`);
    }

    lines.push("}");
    parts.push(lines.join("\n"));
  }

  for (const e of project.enums) {
    const lines: string[] = [`Enum ${quoteIdent(e.name)} {`];
    for (const v of e.values) {
      lines.push(v.note ? `  ${quoteIdent(v.name)} [note: ${quoteNoteText(v.note)}]` : `  ${quoteIdent(v.name)}`);
    }
    lines.push("}");
    parts.push(lines.join("\n"));
  }

  for (const group of project.tableGroups) {
    const memberNames = group.tableIds
      .map((tid) => project.tables.find((t) => t.id === tid))
      .filter((t): t is Table => Boolean(t))
      .map((t) => tableName(t));
    // An empty (or fully-orphaned, every member table deleted) group has
    // nothing meaningful to declare — @dbml/core also rejects `TableGroup g {}`.
    if (memberNames.length === 0) continue;
    parts.push([`TableGroup ${quoteIdent(group.name)} {`, ...memberNames.map((n) => `  ${n}`), `}`].join("\n"));
  }

  for (const ref of project.refs) {
    const from = fieldNameById(project.tables, ref.from.tableId, ref.from.fieldId);
    const to = fieldNameById(project.tables, ref.to.tableId, ref.to.fieldId);
    if (!from || !to) continue;
    const symbol = CARDINALITY_SYMBOL[ref.cardinality];
    const prefix = ref.name ? `Ref ${quoteIdent(ref.name)}:` : "Ref:";
    parts.push(`${prefix} ${from.table}.${from.field} ${symbol} ${to.table}.${to.field}`);
  }

  const raw = parts.join("\n\n");
  const formatted = formatDbml(raw);

  if (options?.includeVisualMetadata) {
    const refEntries: [string, { style?: VisualStyle; routingPoints?: RoutingPoint[] }][] = [];
    for (const ref of project.refs) {
      if (!ref.style && !(ref.routingPoints && ref.routingPoints.length > 0)) continue;
      const key = refSignature(project.tables, ref);
      if (key) refEntries.push([key, { style: ref.style, routingPoints: ref.routingPoints }]);
    }
    const groupEntries = project.tableGroups
      .filter((group) => group.note)
      .map((group) => [group.name, { note: group.note }] as const);

    const metadata: VisualMetadataV1 = {
      tables: Object.fromEntries(
        project.tables.map((table) => [
          table.name,
          { position: table.position, size: table.size, style: table.style, detailLevel: table.detailLevel },
        ]),
      ),
      zones: project.zones,
      stickyNotes: project.stickyNotes,
      enums: Object.fromEntries(project.enums.map((e) => [e.name, { position: e.position }])),
      ...(refEntries.length > 0 ? { refs: Object.fromEntries(refEntries) } : {}),
      ...(groupEntries.length > 0 ? { tableGroups: Object.fromEntries(groupEntries) } : {}),
      ...(project.paletteColors ? { paletteColors: project.paletteColors } : {}),
    };
    return `${formatted}\n${VISUAL_METADATA_MARKER}${JSON.stringify(metadata)}\n`;
  }

  return formatted;
}
