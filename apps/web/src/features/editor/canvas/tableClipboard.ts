import {
  MAX_COLOR_LENGTH,
  MAX_DEFAULT_LENGTH,
  MAX_FIELDS_PER_TABLE,
  MAX_INDEXES_PER_TABLE,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TYPE_LENGTH,
  type DetailLevel,
  type Field,
  type Position,
  type Project,
  type Ref,
  type RefAction,
  type Table,
  type TableIndex,
  type VisualStyle,
} from "@athanordb/shared";
import { projectToDbml } from "@athanordb/dbml-engine";

/**
 * Copy / paste of tables, through the *system* clipboard so it works between
 * two projects, two tabs, and into the DBML editor.
 *
 * What goes on the clipboard is plain DBML — pasting it into the DBML editor,
 * or anywhere else, gives the tables as text — followed by one comment line
 * carrying the tables as the canvas knows them (colours, size, detail level,
 * column ids). DBML alone cannot be pasted back onto the canvas: reading it
 * needs the parser, which the web bundle deliberately does not ship (see
 * CONTRIBUTING.md), and it has no place for colours anyway.
 *
 * The comment is read back from a clipboard anyone can write to, so it is
 * treated as untrusted: rebuilt field by field, never spread into the document.
 */

const MARKER = "// athanordb-clipboard:v1 ";
/** Far above any real selection; keeps a crafted clipboard from flooding the document in one keystroke. */
const MAX_PASTED_TABLES = 200;
const PASTE_OFFSET = 24;

export interface TableClipboard {
  tables: Table[];
  /** Only relations whose two ends are both among `tables`. */
  refs: Ref[];
}

/** The selected tables and the relations between them, or null when no table is selected. */
export function copyTables(project: Project, tableIds: readonly string[]): TableClipboard | null {
  const wanted = new Set(tableIds);
  const tables = project.tables.filter((table) => wanted.has(table.id));
  if (tables.length === 0) return null;
  const copied = new Set(tables.map((table) => table.id));
  return {
    // Comments are a conversation about *that* table, not part of its design.
    tables: tables.map(({ comments: _comments, ...table }) => table),
    refs: project.refs.filter((ref) => copied.has(ref.from.tableId) && copied.has(ref.to.tableId)),
  };
}

export function serializeClipboard(clipboard: TableClipboard): string {
  const dbml = projectToDbml({
    id: "",
    name: "",
    tables: clipboard.tables,
    refs: clipboard.refs,
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  });
  return `${dbml.trimEnd()}\n\n${MARKER}${JSON.stringify(clipboard)}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" ? value.slice(0, max) : undefined;
const flag = (value: unknown): true | undefined => (value === true ? true : undefined);
const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Drops `undefined` entries, so a pasted table has the same shape as one made on the canvas. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function readStyle(raw: unknown): VisualStyle | undefined {
  if (!isRecord(raw)) return undefined;
  const style = compact({
    color: text(raw.color, MAX_COLOR_LENGTH),
    borderColor: text(raw.borderColor, MAX_COLOR_LENGTH),
  });
  return Object.keys(style).length > 0 ? style : undefined;
}

function readPosition(raw: unknown): Position {
  const record = isRecord(raw) ? raw : {};
  return { x: finite(record.x) ?? 0, y: finite(record.y) ?? 0 };
}

const DEFAULT_KINDS = ["expression", "string", "number", "boolean"] as const;
const DETAIL_LEVELS = ["compact", "standard", "full"] as const;
const CARDINALITIES = ["one-to-one", "one-to-many", "many-to-many"] as const;
const REF_ACTIONS = ["cascade", "restrict", "set null", "set default", "no action"] as const;
const oneOf = <T extends string>(choices: readonly T[], value: unknown): T | undefined =>
  choices.find((choice) => choice === value);

function readField(raw: unknown): Field | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, MAX_NAME_LENGTH);
  const name = text(raw.name, MAX_NAME_LENGTH);
  if (!id || !name) return null;
  return compact<Field>({
    id,
    name,
    type: text(raw.type, MAX_TYPE_LENGTH) ?? "",
    pk: flag(raw.pk),
    unique: flag(raw.unique),
    notNull: flag(raw.notNull),
    increment: flag(raw.increment),
    default: text(raw.default, MAX_DEFAULT_LENGTH),
    defaultKind: oneOf(DEFAULT_KINDS, raw.defaultKind),
    note: text(raw.note, MAX_NOTE_LENGTH),
  });
}

function readTable(raw: unknown): Table | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, MAX_NAME_LENGTH);
  const name = text(raw.name, MAX_NAME_LENGTH);
  if (!id || !name || !Array.isArray(raw.fields)) return null;
  const fields = raw.fields
    .slice(0, MAX_FIELDS_PER_TABLE)
    .map(readField)
    .filter((field): field is Field => field !== null);
  // A table without a column cannot be written as DBML (see `addTable`).
  if (fields.length === 0) return null;
  const fieldIds = new Set(fields.map((field) => field.id));
  const indexes = (Array.isArray(raw.indexes) ? raw.indexes : [])
    .slice(0, MAX_INDEXES_PER_TABLE)
    .map((index: unknown): TableIndex | null => {
      if (!isRecord(index) || !Array.isArray(index.fieldIds)) return null;
      const columns = index.fieldIds.filter((fieldId): fieldId is string => fieldIds.has(fieldId as string));
      if (columns.length === 0) return null;
      return compact<TableIndex>({
        id: text(index.id, MAX_NAME_LENGTH) ?? "",
        fieldIds: columns,
        unique: flag(index.unique),
        pk: flag(index.pk),
        name: text(index.name, MAX_NAME_LENGTH),
      });
    })
    .filter((index): index is TableIndex => index !== null);
  const size = isRecord(raw.size) ? { width: finite(raw.size.width), height: finite(raw.size.height) } : null;
  return compact<Table>({
    id,
    name,
    schemaName: text(raw.schemaName, MAX_NAME_LENGTH),
    note: text(raw.note, MAX_NOTE_LENGTH),
    fields,
    indexes,
    position: readPosition(raw.position),
    size: size?.width && size.height ? { width: size.width, height: size.height } : undefined,
    style: readStyle(raw.style),
    detailLevel: oneOf<DetailLevel>(DETAIL_LEVELS, raw.detailLevel) ?? "standard",
  });
}

function readRef(raw: unknown, tables: Table[]): Ref | null {
  if (!isRecord(raw) || !isRecord(raw.from) || !isRecord(raw.to)) return null;
  const cardinality = oneOf(CARDINALITIES, raw.cardinality);
  const endpoint = (end: Record<string, unknown>) => {
    const table = tables.find((candidate) => candidate.id === end.tableId);
    const field = table?.fields.find((candidate) => candidate.id === end.fieldId);
    return table && field ? { tableId: table.id, fieldId: field.id } : null;
  };
  const from = endpoint(raw.from);
  const to = endpoint(raw.to);
  if (!cardinality || !from || !to) return null;
  return compact<Ref>({
    id: "",
    name: text(raw.name, MAX_NAME_LENGTH),
    from,
    to,
    cardinality,
    style: readStyle(raw.style),
    onDelete: oneOf<RefAction>(REF_ACTIONS, raw.onDelete),
    onUpdate: oneOf<RefAction>(REF_ACTIONS, raw.onUpdate),
  });
}

/** Tables found in a clipboard text, or null when it is not one of ours (or carries nothing usable). */
export function parseClipboard(clipboardText: string): TableClipboard | null {
  const line = clipboardText.split("\n").find((candidate) => candidate.startsWith(MARKER));
  if (!line) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line.slice(MARKER.length));
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.tables)) return null;
  const tables = raw.tables
    .slice(0, MAX_PASTED_TABLES)
    .map(readTable)
    .filter((table): table is Table => table !== null);
  if (tables.length === 0) return null;
  const refs = (Array.isArray(raw.refs) ? raw.refs : [])
    .map((ref: unknown) => readRef(ref, tables))
    .filter((ref): ref is Ref => ref !== null);
  return { tables, refs };
}

/** `users` → `users_copy`, then `users_copy2`, `users_copy3`… — whichever is free. Names compare case-insensitively, like everywhere else. */
export function uniqueCopyName(name: string, taken: Set<string>): string {
  const base = `${name.replace(/_copy\d*$/i, "").slice(0, MAX_NAME_LENGTH - 10)}_copy`;
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}${n}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

export interface PasteTarget {
  /** Top-left corner for the pasted group (a right-click position). Without it the copies sit next to their originals. */
  at?: Position;
  /** How many times this same clipboard was already pasted — each paste steps further away so copies do not stack. */
  repeat?: number;
}

/**
 * The tables and relations to add to a project for one paste: fresh ids
 * throughout, names made unique, everything else as it was copied. Relations
 * between two pasted tables follow them to the copies.
 */
export function instantiateClipboard(
  clipboard: TableClipboard,
  existingTables: readonly Table[],
  target: PasteTarget,
  generateId: () => string,
): TableClipboard {
  const taken = new Set(existingTables.map((table) => table.name.toLowerCase()));
  const origin = {
    x: Math.min(...clipboard.tables.map((table) => table.position.x)),
    y: Math.min(...clipboard.tables.map((table) => table.position.y)),
  };
  const step = PASTE_OFFSET * ((target.repeat ?? 0) + 1);
  const shift = target.at ? { x: target.at.x - origin.x, y: target.at.y - origin.y } : { x: step, y: step };

  const tableIds = new Map<string, string>();
  const fieldIds = new Map<string, string>();
  const tables = clipboard.tables.map((table): Table => {
    const id = generateId();
    tableIds.set(table.id, id);
    const fields = table.fields.map((field) => {
      const fieldId = generateId();
      fieldIds.set(`${table.id}/${field.id}`, fieldId);
      return { ...field, id: fieldId };
    });
    return {
      ...table,
      id,
      name: uniqueCopyName(table.name, taken),
      position: { x: table.position.x + shift.x, y: table.position.y + shift.y },
      fields,
      indexes: table.indexes.map((index) => ({
        ...index,
        id: generateId(),
        fieldIds: index.fieldIds.map((fieldId) => fieldIds.get(`${table.id}/${fieldId}`)!),
      })),
    };
  });

  const refs = clipboard.refs.map((ref): Ref => {
    const end = (endpoint: Ref["from"]) => ({
      tableId: tableIds.get(endpoint.tableId)!,
      fieldId: fieldIds.get(`${endpoint.tableId}/${endpoint.fieldId}`)!,
    });
    // Waypoints are positions on the canvas: they would stay behind, between the originals.
    const copy: Ref = { ...ref, id: generateId(), from: end(ref.from), to: end(ref.to) };
    delete copy.routingPoints;
    return copy;
  });

  return { tables, refs };
}
