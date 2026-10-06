import {
  MAX_COLOR_LENGTH,
  MAX_DEFAULT_LENGTH,
  MAX_FIELDS_PER_TABLE,
  MAX_INDEXES_PER_TABLE,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TYPE_LENGTH,
  MAX_VALUES_PER_ENUM,
  type DetailLevel,
  type EnumDef,
  type EnumValue,
  type Field,
  type Position,
  type Project,
  type Ref,
  type RefAction,
  type Size,
  type StickyNote,
  type Table,
  type TableIndex,
  type VisualStyle,
  type Zone,
} from "@nebuladb/shared";
import { projectToDbml } from "@nebuladb/dbml-engine";

/**
 * Copy / paste of tables, enums, zones and sticky notes through the *system* clipboard, so it
 * works across projects, tabs and into the DBML editor.
 *
 * The clipboard holds plain DBML (zones and notes become one `//` comment line each) followed by
 * one comment line carrying the elements as the canvas knows them (colours, size, detail level,
 * column ids). DBML alone can't be pasted back: the web bundle doesn't ship the parser.
 *
 * That comment is read from a clipboard anyone can write to, so it is untrusted: rebuilt field
 * by field, never spread into the document.
 */

const MARKER = "// nebuladb-clipboard:v1 ";
const LEGACY_MARKER = "// athanordb-clipboard:v1 ";
/** Far above any real selection; keeps a crafted clipboard from flooding the document in one keystroke. */
const MAX_PASTED_TABLES = 200;
const MAX_PASTED_OTHERS = 200;
const PASTE_OFFSET = 24;

export interface CanvasClipboard {
  tables: Table[];
  /** Only relations whose two ends are both among `tables`: one that points at a table left behind is not copied. */
  refs: Ref[];
  enums: EnumDef[];
  zones: Zone[];
  stickyNotes: StickyNote[];
}

/** The ids selected on the canvas, by kind. */
export interface CanvasSelection {
  tableIds: readonly string[];
  enumIds?: readonly string[];
  zoneIds?: readonly string[];
  noteIds?: readonly string[];
}

/** The selected elements and the relations between the selected tables, or null when nothing is selected. */
export function copySelection(project: Project, selection: CanvasSelection): CanvasClipboard | null {
  const pick = <T extends { id: string }>(all: readonly T[], ids: readonly string[] | undefined): T[] => {
    const wanted = new Set(ids ?? []);
    return all.filter((item) => wanted.has(item.id));
  };
  const tables = pick(project.tables, selection.tableIds);
  const enums = pick(project.enums, selection.enumIds);
  const zones = pick(project.zones, selection.zoneIds);
  const stickyNotes = pick(project.stickyNotes, selection.noteIds);
  if (tables.length + enums.length + zones.length + stickyNotes.length === 0) return null;
  const copied = new Set(tables.map((table) => table.id));
  return {
    // Comments are a conversation about *that* table, not part of its design.
    tables: tables.map(({ comments: _comments, ...table }) => table),
    refs: project.refs.filter((ref) => copied.has(ref.from.tableId) && copied.has(ref.to.tableId)),
    enums,
    zones,
    stickyNotes,
  };
}

/** How many elements a clipboard holds — what the "copied" / "pasted" message counts. */
export function clipboardSize(clipboard: CanvasClipboard): number {
  return clipboard.tables.length + clipboard.enums.length + clipboard.zones.length + clipboard.stickyNotes.length;
}

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 120);

export function serializeClipboard(clipboard: CanvasClipboard): string {
  const dbml = projectToDbml({
    id: "",
    name: "",
    tables: clipboard.tables,
    refs: clipboard.refs,
    enums: clipboard.enums,
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  });
  // No DBML form for these: a comment keeps them readable where the text is pasted.
  const others = [
    ...clipboard.zones.map((zone) => `// Zone: ${oneLine(zone.label)}`),
    ...clipboard.stickyNotes.map((note) => `// Note: ${oneLine(note.text)}`),
  ];
  const readable = [dbml.trimEnd(), others.join("\n")].filter((part) => part !== "").join("\n\n");
  return `${readable}\n\n${MARKER}${JSON.stringify(clipboard)}\n`;
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

function readSize(raw: unknown): Size {
  const record = isRecord(raw) ? raw : {};
  return { width: finite(record.width) ?? 200, height: finite(record.height) ?? 120 };
}

function readEnum(raw: unknown): EnumDef | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, MAX_NAME_LENGTH);
  const name = text(raw.name, MAX_NAME_LENGTH);
  if (!id || !name || !Array.isArray(raw.values)) return null;
  const values = raw.values
    .slice(0, MAX_VALUES_PER_ENUM)
    .map((value: unknown): EnumValue | null => {
      if (!isRecord(value)) return null;
      const valueId = text(value.id, MAX_NAME_LENGTH);
      const valueName = text(value.name, MAX_NAME_LENGTH);
      if (!valueId || !valueName) return null;
      return compact<EnumValue>({ id: valueId, name: valueName, note: text(value.note, MAX_NOTE_LENGTH) });
    })
    .filter((value): value is EnumValue => value !== null);
  return { id, name, values, position: readPosition(raw.position) };
}

function readZone(raw: unknown): Zone | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, MAX_NAME_LENGTH);
  if (!id) return null;
  return compact<Zone>({
    id,
    label: text(raw.label, MAX_NAME_LENGTH) ?? "",
    position: readPosition(raw.position),
    size: readSize(raw.size),
    style: readStyle(raw.style),
  });
}

function readStickyNote(raw: unknown): StickyNote | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, MAX_NAME_LENGTH);
  if (!id) return null;
  return compact<StickyNote>({
    id,
    text: text(raw.text, MAX_TEXT_LENGTH) ?? "",
    position: readPosition(raw.position),
    size: readSize(raw.size),
    style: readStyle(raw.style),
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

/** Elements found in a clipboard text, or null when it is not one of ours (or carries nothing usable). */
export function parseClipboard(clipboardText: string): CanvasClipboard | null {
  const line = clipboardText
    .split("\n")
    .find((candidate) => candidate.startsWith(MARKER) || candidate.startsWith(LEGACY_MARKER));
  if (!line) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line.slice(line.startsWith(MARKER) ? MARKER.length : LEGACY_MARKER.length));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  // Every kind is optional: a clipboard written before enums, zones and notes were copyable holds tables only.
  const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
  const tables = list(raw.tables, MAX_PASTED_TABLES)
    .map(readTable)
    .filter((table): table is Table => table !== null);
  const enums = list(raw.enums, MAX_PASTED_OTHERS)
    .map(readEnum)
    .filter((entry): entry is EnumDef => entry !== null);
  const zones = list(raw.zones, MAX_PASTED_OTHERS)
    .map(readZone)
    .filter((zone): zone is Zone => zone !== null);
  const stickyNotes = list(raw.stickyNotes, MAX_PASTED_OTHERS)
    .map(readStickyNote)
    .filter((note): note is StickyNote => note !== null);
  if (tables.length + enums.length + zones.length + stickyNotes.length === 0) return null;
  const refs = (Array.isArray(raw.refs) ? raw.refs : [])
    .map((ref: unknown) => readRef(ref, tables))
    .filter((ref): ref is Ref => ref !== null);
  return { tables, refs, enums, zones, stickyNotes };
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
 * The elements and relations to add to a project for one paste: fresh ids
 * throughout, table and enum names made unique (a zone or a note has no unique
 * name: its copy keeps the label, as Ctrl+D does), everything else as it was
 * copied. Relations between two pasted tables follow them to the copies.
 */
export function instantiateClipboard(
  clipboard: CanvasClipboard,
  existing: { tables: readonly Table[]; enums?: readonly EnumDef[] },
  target: PasteTarget,
  generateId: () => string,
): CanvasClipboard {
  const taken = new Set(existing.tables.map((table) => table.name.toLowerCase()));
  const takenEnums = new Set((existing.enums ?? []).map((entry) => entry.name.toLowerCase()));
  const positions = [...clipboard.tables, ...clipboard.enums, ...clipboard.zones, ...clipboard.stickyNotes].map(
    (element) => element.position,
  );
  const origin = {
    x: Math.min(...positions.map((position) => position.x)),
    y: Math.min(...positions.map((position) => position.y)),
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

  const moved = (position: Position): Position => ({ x: position.x + shift.x, y: position.y + shift.y });
  const enums = clipboard.enums.map((entry): EnumDef => ({
    ...entry,
    id: generateId(),
    name: uniqueCopyName(entry.name, takenEnums),
    position: moved(entry.position),
    values: entry.values.map((value) => ({ ...value, id: generateId() })),
  }));
  const zones = clipboard.zones.map((zone): Zone => ({ ...zone, id: generateId(), position: moved(zone.position) }));
  const stickyNotes = clipboard.stickyNotes.map((note): StickyNote => ({
    ...note,
    id: generateId(),
    position: moved(note.position),
  }));

  return { tables, refs, enums, zones, stickyNotes };
}
