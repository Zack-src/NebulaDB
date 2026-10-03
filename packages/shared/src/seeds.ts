import type { DatabaseEngine, Field, Ref, Table } from "./schema.js";

/**
 * Seeds: the rows a table starts with, kept as a CSV file next to the schema
 * and inserted after the DDL of a deployment. Everything here is pure, so the
 * editor's preview and the server's check before a deployment are the same
 * code and cannot disagree.
 */

/** `if-empty`: insert only into an empty table (the default — a deployment never piles rows up). `append`: always insert. */
export type SeedMode = "if-empty" | "append";
export const SEED_MODES: readonly SeedMode[] = ["if-empty", "append"];

export type SeedSeparator = "," | ";" | "\t" | "|";
export const SEED_SEPARATORS: readonly SeedSeparator[] = [",", ";", "\t", "|"];

/** 2 MB of CSV and 50 000 rows: a seed is reference data, not a data load. */
export const SEED_MAX_BYTES = 2_000_000;
export const SEED_MAX_ROWS = 50_000;
/** Issues reported for one seed; the rest are counted. */
export const SEED_MAX_ISSUES = 200;

export interface SeedOptions {
  separator: SeedSeparator;
  /** The first line names the columns. */
  header: boolean;
  /** For each CSV column, the field id it fills, or `null` to ignore it. */
  mapping: (string | null)[];
  mode: SeedMode;
}

/** A table's seed as listed — everything but the file itself. */
export interface TableSeedSummary {
  tableId: string;
  tableName: string;
  format: "csv";
  rowCount: number;
  bytes: number;
  options: SeedOptions;
  updatedAt: string;
  updatedByName: string | null;
}

export interface TableSeed extends TableSeedSummary {
  content: string;
}

export type SeedIssueKind =
  "not-null" | "type" | "length" | "unique" | "foreign-key" | "missing-column" | "formula" | "width";

export interface SeedIssue {
  kind: SeedIssueKind;
  /** 1-based data row (header excluded); 0 for an issue about the file as a whole. */
  row: number;
  /** The table column concerned. */
  column?: string;
  value?: string;
  /** A formula-looking value is only a warning: it is stored as text, but a spreadsheet would run it. */
  severity: "error" | "warning";
}

/**
 * RFC 4180 CSV: quoted fields with `""` escapes and line breaks inside, CRLF
 * or LF, a leading BOM dropped. An **unquoted empty** cell is `null` (SQL
 * NULL); a quoted one (`""`) is the empty string.
 */
export function parseCsv(text: string, separator: SeedSeparator): (string | null)[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell === "" && !wasQuoted ? null : cell);
    cell = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    // A blank line is not a row of one NULL.
    if (!(row.length === 1 && row[0] === null)) rows.push(row);
    row = [];
  };
  while (i < source.length) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      wasQuoted = true;
      i++;
    } else if (ch === separator) {
      endCell();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && source[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== "" || wasQuoted || row.length > 0) endRow();
  return rows;
}

/** The separator the first line uses most, `,` when it says nothing. */
export function detectSeparator(text: string): SeedSeparator {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best: SeedSeparator = ",";
  let bestCount = 0;
  for (const separator of SEED_SEPARATORS) {
    const count = firstLine.split(separator).length - 1;
    if (count > bestCount) {
      best = separator;
      bestCount = count;
    }
  }
  return best;
}

const loose = (name: string) => name.toLowerCase().replace(/[\s_\-.]/g, "");

/** For each header, the field it most likely fills: same name, then same name ignoring case, spaces and `_-.`. */
export function suggestMapping(headers: readonly (string | null)[], fields: readonly Field[]): (string | null)[] {
  const used = new Set<string>();
  return headers.map((header) => {
    if (!header) return null;
    const match =
      fields.find((field) => !used.has(field.id) && field.name === header.trim()) ??
      fields.find((field) => !used.has(field.id) && loose(field.name) === loose(header));
    if (!match) return null;
    used.add(match.id);
    return match.id;
  });
}

/** The CSV as rows for the table: the mapped fields (by name, in mapping order) and their values. */
export function seedRows(
  parsed: (string | null)[][],
  options: Pick<SeedOptions, "header" | "mapping">,
  table: Table,
): { columns: Field[]; rows: (string | null)[][]; width: number } {
  const body = options.header ? parsed.slice(1) : parsed;
  const picked: { index: number; field: Field }[] = [];
  options.mapping.forEach((fieldId, index) => {
    const field = fieldId ? table.fields.find((f) => f.id === fieldId) : undefined;
    if (field) picked.push({ index, field });
  });
  return {
    columns: picked.map((p) => p.field),
    rows: body.map((cells) => picked.map((p) => cells[p.index] ?? null)),
    width: options.mapping.length,
  };
}

type TypeFamily = "integer" | "decimal" | "boolean" | "date" | "datetime" | "uuid" | "text";

function typeFamily(type: string): TypeFamily {
  const t = type.toLowerCase().trim();
  if (/^(tiny|small|medium|big)?int(eger)?\d*\b|^(small|big)?serial\b|^int[248]\b/.test(t)) return "integer";
  if (/^(numeric|decimal|number|float\d*|double|real|money)\b/.test(t)) return "decimal";
  if (/^bool(ean)?\b|^bit\b/.test(t)) return "boolean";
  if (/^date$/.test(t)) return "date";
  if (/^(timestamp|datetime|smalldatetime|datetime2|timestamptz)\b/.test(t)) return "datetime";
  if (/^(uuid|uniqueidentifier)\b/.test(t)) return "uuid";
  return "text";
}

const BOOLEAN_TRUE = new Set(["true", "t", "1", "yes", "y", "oui"]);
const BOOLEAN_FALSE = new Set(["false", "f", "0", "no", "n", "non"]);

function fitsType(value: string, family: TypeFamily): boolean {
  switch (family) {
    case "integer":
      return /^[-+]?\d+$/.test(value.trim());
    case "decimal":
      return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value.trim());
    case "boolean":
      return BOOLEAN_TRUE.has(value.trim().toLowerCase()) || BOOLEAN_FALSE.has(value.trim().toLowerCase());
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(Date.parse(value.trim()));
    case "datetime":
      return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value.trim());
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
    default:
      return true;
  }
}

function declaredLength(type: string): number | null {
  const match = /^\s*(?:n?var)?char(?:acter)?(?:\s+varying)?2?\s*\(\s*(\d+)/i.exec(type);
  return match ? Number(match[1]) : null;
}

/** What a field must receive when a seed leaves it out: NOT NULL without a default nor an auto value. */
function isRequired(field: Field): boolean {
  return (
    Boolean(field.notNull || field.pk) && !field.increment && (field.default === undefined || field.default === "")
  );
}

export interface SeedValidationContext {
  /** Values of the referenced columns known from other seeds, keyed `tableId.fieldId` — a foreign key is only checked against those. */
  parentValues?: ReadonlyMap<string, ReadonlySet<string>>;
  refs?: readonly Ref[];
}

/**
 * What would make the insert fail or surprise: a NULL in a NOT NULL column,
 * a value that is not of the column's type or longer than its limit, a
 * duplicate under a primary key or UNIQUE, a foreign key with no parent among
 * the parent table's own seed, a required column the CSV does not fill, a row
 * of the wrong width. Formula-looking text (`=`, `+`, `-`, `@` first) is a
 * warning: stored as text, but run by a spreadsheet that opens an export.
 */
export function validateSeed(
  table: Table,
  parsed: (string | null)[][],
  options: Pick<SeedOptions, "header" | "mapping">,
  context: SeedValidationContext = {},
): { issues: SeedIssue[]; total: number } {
  const issues: SeedIssue[] = [];
  let total = 0;
  const report = (issue: SeedIssue) => {
    total++;
    if (issues.length < SEED_MAX_ISSUES) issues.push(issue);
  };
  const { columns, rows, width } = seedRows(parsed, options, table);

  const mapped = new Set(columns.map((field) => field.id));
  for (const field of table.fields) {
    if (!mapped.has(field.id) && isRequired(field))
      report({ kind: "missing-column", row: 0, column: field.name, severity: "error" });
  }
  const body = options.header ? parsed.slice(1) : parsed;
  body.forEach((cells, index) => {
    if (cells.length !== width)
      report({ kind: "width", row: index + 1, value: String(cells.length), severity: "error" });
  });

  const families = columns.map((field) => typeFamily(field.type));
  const limits = columns.map((field) => declaredLength(field.type));
  const uniqueSets: { label: string; indexes: number[]; seen: Set<string> }[] = [];
  const pkIndexes = columns.map((field, i) => (field.pk ? i : -1)).filter((i) => i >= 0);
  if (pkIndexes.length > 0)
    uniqueSets.push({ label: pkIndexes.map((i) => columns[i].name).join(", "), indexes: pkIndexes, seen: new Set() });
  columns.forEach((field, i) => {
    if (field.unique && !field.pk) uniqueSets.push({ label: field.name, indexes: [i], seen: new Set() });
  });
  for (const index of table.indexes) {
    if (!index.unique && !index.pk) continue;
    const positions = index.fieldIds.map((id) => columns.findIndex((field) => field.id === id));
    if (positions.some((p) => p < 0)) continue;
    uniqueSets.push({ label: positions.map((p) => columns[p].name).join(", "), indexes: positions, seen: new Set() });
  }

  const foreignKeys = (context.refs ?? [])
    .filter((ref) => ref.from.tableId === table.id)
    .map((ref) => ({
      position: columns.findIndex((field) => field.id === ref.from.fieldId),
      parent: context.parentValues?.get(`${ref.to.tableId}.${ref.to.fieldId}`),
    }))
    .filter((fk) => fk.position >= 0 && fk.parent !== undefined);

  rows.forEach((row, r) => {
    const rowNumber = r + 1;
    row.forEach((value, c) => {
      const field = columns[c];
      if (value === null) {
        if (field.notNull || field.pk)
          report({ kind: "not-null", row: rowNumber, column: field.name, severity: "error" });
        return;
      }
      if (!fitsType(value, families[c])) {
        report({ kind: "type", row: rowNumber, column: field.name, value, severity: "error" });
      } else if (limits[c] !== null && [...value].length > limits[c]!) {
        report({ kind: "length", row: rowNumber, column: field.name, value, severity: "error" });
      }
      if (families[c] === "text" && /^[=+\-@\t\r]/.test(value) && !/^[-+]?\d/.test(value)) {
        report({ kind: "formula", row: rowNumber, column: field.name, value, severity: "warning" });
      }
    });
    for (const set of uniqueSets) {
      const parts = set.indexes.map((i) => row[i]);
      if (parts.some((part) => part === null)) continue;
      const key = JSON.stringify(parts);
      if (set.seen.has(key))
        report({ kind: "unique", row: rowNumber, column: set.label, value: parts.join(", "), severity: "error" });
      set.seen.add(key);
    }
    for (const fk of foreignKeys) {
      const value = row[fk.position];
      if (value !== null && !fk.parent!.has(value)) {
        report({ kind: "foreign-key", row: rowNumber, column: columns[fk.position].name, value, severity: "error" });
      }
    }
  });
  return { issues, total };
}

/** The values a seed gives each column, keyed `tableId.fieldId` — what children's foreign keys are checked against. */
export function seedColumnValues(
  table: Table,
  parsed: (string | null)[][],
  options: Pick<SeedOptions, "header" | "mapping">,
): Map<string, Set<string>> {
  const { columns, rows } = seedRows(parsed, options, table);
  const values = new Map<string, Set<string>>();
  columns.forEach((field, c) => {
    const set = new Set<string>();
    for (const row of rows) if (row[c] !== null) set.add(row[c]!);
    values.set(`${table.id}.${field.id}`, set);
  });
  return values;
}

/**
 * The order to insert seeded tables in: a table after the tables its foreign
 * keys point at. A cycle among seeded tables has no such order — it is
 * returned (table ids) for the caller to refuse. A table pointing at itself
 * is not a cycle: its rows go in file order.
 */
export function seedInsertOrder(
  seededTableIds: readonly string[],
  refs: readonly Ref[],
): { order: string[]; cycles: string[][] } {
  const seeded = new Set(seededTableIds);
  const dependsOn = new Map<string, Set<string>>(seededTableIds.map((id) => [id, new Set()]));
  for (const ref of refs) {
    if (ref.from.tableId === ref.to.tableId) continue;
    if (seeded.has(ref.from.tableId) && seeded.has(ref.to.tableId))
      dependsOn.get(ref.from.tableId)!.add(ref.to.tableId);
  }
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (id: string) => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") {
      cycles.push(stack.slice(stack.indexOf(id)));
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const parent of dependsOn.get(id) ?? []) visit(parent);
    stack.pop();
    state.set(id, "done");
    order.push(id);
  };
  for (const id of seededTableIds) visit(id);
  return { order, cycles };
}

/** A seed value as the target engine wants it: booleans spelt the engine's way, everything else as written. */
export function normalizeSeedValue(value: string | null, field: Field, engine: DatabaseEngine): string | null {
  if (value === null || typeFamily(field.type) !== "boolean") return value;
  const truthy = BOOLEAN_TRUE.has(value.trim().toLowerCase());
  return engine === "postgres" ? (truthy ? "true" : "false") : truthy ? "1" : "0";
}

/** What a deployment plan would do with one table's seed. */
export interface SeedPlanEntry {
  tableId: string;
  tableName: string;
  rows: number;
  mode: SeedMode;
  /** `insert`: the rows go in. `skip-not-empty`: `if-empty` and the table already has rows. `unmeasured`: the row count could not be read. */
  action: "insert" | "skip-not-empty" | "unmeasured";
  existingRows: number | null;
  errors: number;
  warnings: number;
}
