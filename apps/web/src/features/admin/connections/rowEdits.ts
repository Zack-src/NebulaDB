import type { DbRowCell, DbRowEditColumn, DbRowEditing, DbRowOperation } from "@nebuladb/shared";

/**
 * The explorer's pending row edits: what the user changed in the grid and has
 * not applied yet. Plain values, replaced on every change (never mutated), so
 * a component can hold them in `$state.raw`. The server decides again on
 * everything here — this only keeps track of what will be asked of it.
 */

/** An existing row the user changed or marked for deletion, by its key. */
export interface PendingRow {
  key: Record<string, string>;
  /** The whole row as it was read, by column name. */
  original: Record<string, DbRowCell>;
  /** The cells changed, by column name. */
  values: Record<string, DbRowCell>;
  deleted: boolean;
}

/** A row to insert. A column absent from `values` is left to its default. */
export interface PendingInsert {
  id: number;
  values: Record<string, DbRowCell>;
}

export interface PendingEdits {
  rows: Record<string, PendingRow>;
  inserts: PendingInsert[];
  nextId: number;
}

export const NO_EDITS: PendingEdits = { rows: {}, inserts: [], nextId: 1 };

/**
 * The key of a row as text, or `null` when the row cannot be identified (a key
 * cell that is NULL or not shown whole) — such a row stays read-only.
 */
export function rowIdentity(
  editing: DbRowEditing,
  columns: readonly string[],
  row: readonly unknown[],
  partial: ReadonlySet<string> = new Set(),
  rowIndex = -1,
): string | null {
  const values: string[] = [];
  for (const name of editing.key) {
    const index = columns.indexOf(name);
    const cell = row[index];
    if (index < 0 || typeof cell !== "string" || partial.has(cellId(rowIndex, index))) return null;
    values.push(cell);
  }
  return JSON.stringify(values);
}

/** How the partial cells of a page are looked up. */
export function cellId(row: number, column: number): string {
  return `${row}:${column}`;
}

function rowRecord(columns: readonly string[], row: readonly unknown[]): Record<string, DbRowCell> {
  return Object.fromEntries(columns.map((name, index) => [name, (row[index] ?? null) as DbRowCell]));
}

function keyOf(editing: DbRowEditing, original: Record<string, DbRowCell>): Record<string, string> {
  return Object.fromEntries(editing.key.map((name) => [name, original[name] as string]));
}

/** Keeps the rows that still carry a change, so "nothing pending" is an empty object. */
function withRow(edits: PendingEdits, identity: string, row: PendingRow | null): PendingEdits {
  const rows = { ...edits.rows };
  if (row && (row.deleted || Object.keys(row.values).length > 0)) rows[identity] = row;
  else delete rows[identity];
  return { ...edits, rows };
}

/** Sets one cell of an existing row; setting it back to what was read drops the change. */
export function setCell(
  edits: PendingEdits,
  editing: DbRowEditing,
  columns: readonly string[],
  row: readonly unknown[],
  identity: string,
  column: string,
  value: DbRowCell,
): PendingEdits {
  const current = edits.rows[identity];
  const original = current?.original ?? rowRecord(columns, row);
  const values = { ...current?.values };
  if (original[column] === value) delete values[column];
  else values[column] = value;
  return withRow(edits, identity, {
    key: current?.key ?? keyOf(editing, original),
    original,
    values,
    deleted: current?.deleted ?? false,
  });
}

/** Marks a row for deletion, or takes the mark back. Its changed cells are kept for the latter. */
export function toggleDelete(
  edits: PendingEdits,
  editing: DbRowEditing,
  columns: readonly string[],
  row: readonly unknown[],
  identity: string,
): PendingEdits {
  const current = edits.rows[identity];
  const original = current?.original ?? rowRecord(columns, row);
  return withRow(edits, identity, {
    key: current?.key ?? keyOf(editing, original),
    original,
    values: current?.values ?? {},
    deleted: !current?.deleted,
  });
}

export function addInsert(edits: PendingEdits, values: Record<string, DbRowCell> = {}): PendingEdits {
  return { ...edits, inserts: [...edits.inserts, { id: edits.nextId, values }], nextId: edits.nextId + 1 };
}

/** `undefined`: back to the column's default. */
export function setInsertCell(
  edits: PendingEdits,
  id: number,
  column: string,
  value: DbRowCell | undefined,
): PendingEdits {
  return {
    ...edits,
    inserts: edits.inserts.map((insert) => {
      if (insert.id !== id) return insert;
      const values = { ...insert.values };
      if (value === undefined) delete values[column];
      else values[column] = value;
      return { ...insert, values };
    }),
  };
}

export function removeInsert(edits: PendingEdits, id: number): PendingEdits {
  return { ...edits, inserts: edits.inserts.filter((insert) => insert.id !== id) };
}

export function countEdits(edits: PendingEdits): { insert: number; update: number; delete: number; total: number } {
  const rows = Object.values(edits.rows);
  const counts = {
    insert: edits.inserts.length,
    update: rows.filter((row) => !row.deleted).length,
    delete: rows.filter((row) => row.deleted).length,
  };
  return { ...counts, total: counts.insert + counts.update + counts.delete };
}

/**
 * The batch to send: deletions first (a deleted row may free a unique value a
 * change or an insert takes), then changes, then inserts. An update carries
 * the values its edited cells had when read; a deletion, the whole row.
 */
export function toOperations(edits: PendingEdits): DbRowOperation[] {
  const rows = Object.values(edits.rows);
  return [
    ...rows
      .filter((row) => row.deleted)
      .map((row): DbRowOperation => ({ type: "delete", key: row.key, original: row.original })),
    ...rows
      .filter((row) => !row.deleted)
      .map((row): DbRowOperation => ({
        type: "update",
        key: row.key,
        original: Object.fromEntries(Object.keys(row.values).map((name) => [name, row.original[name]])),
        values: row.values,
      })),
    ...edits.inserts.map((insert): DbRowOperation => ({ type: "insert", values: insert.values })),
  ];
}

export type RowTone = "added" | "deleted" | "changed" | null;

export interface DisplayedRows {
  rows: DbRowCell[][];
  tones: RowTone[];
  /** `cellId` of the cells holding a value not yet applied. */
  changed: Set<string>;
  /** Per displayed row: the row's identity, or the id of a pending insert. */
  sources: ({ identity: string } | { insert: number } | null)[];
}

/** The page as it will look once applied: changed values in place, deletions marked, inserts at the end. */
export function displayedRows(
  edits: PendingEdits,
  editing: DbRowEditing,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  partial: ReadonlySet<string>,
): DisplayedRows {
  const out: DisplayedRows = { rows: [], tones: [], changed: new Set(), sources: [] };
  rows.forEach((row, r) => {
    const identity = rowIdentity(editing, columns, row, partial, r);
    const pending = identity === null ? undefined : edits.rows[identity];
    out.rows.push(
      columns.map((name, c) => {
        if (pending && name in pending.values) {
          out.changed.add(cellId(r, c));
          return pending.values[name];
        }
        return (row[c] ?? null) as DbRowCell;
      }),
    );
    out.tones.push(pending ? (pending.deleted ? "deleted" : "changed") : null);
    out.sources.push(identity === null ? null : { identity });
  });
  for (const insert of edits.inserts) {
    const r = out.rows.length;
    out.rows.push(
      columns.map((name, c) => {
        if (!(name in insert.values)) return null;
        out.changed.add(cellId(r, c));
        return insert.values[name];
      }),
    );
    out.tones.push("added");
    out.sources.push({ insert: insert.id });
  }
  return out;
}

const INTEGER = /^[+-]?\d+$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const SPECIAL_NUMBER = /^[+-]?(nan|inf(inity)?)$/i;

export type CellProblem = "integer" | "number" | "json" | "required";

/**
 * What is wrong with a value typed for `column`, before the server says the
 * same: a number column takes digits (never through a JavaScript number), JSON
 * must parse, a NOT NULL column refuses NULL unless it has a default.
 */
export function cellProblem(column: DbRowEditColumn, value: DbRowCell, engine?: string): CellProblem | null {
  if (value === null) return column.nullable ? null : "required";
  if (column.kind === "integer" || (column.kind === "boolean" && engine === "mysql")) {
    return INTEGER.test(value) ? null : "integer";
  }
  if (column.kind === "decimal" || column.kind === "float") {
    return NUMBER.test(value) || (engine === "postgres" && SPECIAL_NUMBER.test(value)) ? null : "number";
  }
  if (column.kind === "json") {
    try {
      JSON.parse(value);
      return null;
    } catch {
      return "json";
    }
  }
  return null;
}
