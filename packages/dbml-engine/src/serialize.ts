import type { DetailLevel, Position, Project, Ref, Size, StickyNote, Table, VisualStyle, Zone } from "@athanordb/shared";
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

/** Overlays sidecar visual metadata (if any) from raw DBML source onto an already-parsed `Project`, matching tables by name. */
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
  return {
    ...project,
    tables,
    zones: meta.zones ?? project.zones,
    stickyNotes: meta.stickyNotes ?? project.stickyNotes,
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
    const metadata: VisualMetadataV1 = {
      tables: Object.fromEntries(
        project.tables.map((table) => [
          table.name,
          { position: table.position, size: table.size, style: table.style, detailLevel: table.detailLevel },
        ]),
      ),
      zones: project.zones,
      stickyNotes: project.stickyNotes,
    };
    return `${formatted}\n${VISUAL_METADATA_MARKER}${JSON.stringify(metadata)}\n`;
  }

  return formatted;
}
