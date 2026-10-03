import type { Field, Project, Ref, RefAction, Table } from "@athanordb/shared";

/**
 * A schema reduced to what makes it *this* schema, in one canonical form, with
 * a hash per table and one for the whole.
 *
 * It exists so that "has this database changed?" has a single answer shared by
 * everything that asks it — drift detection, the before / after of a
 * deployment, comparing two environments — instead of each of them normalising
 * types and ordering in its own slightly different way.
 *
 * What is kept: tables, columns (type, nullability, default, auto-increment),
 * primary key, unique and plain indexes (by their columns), foreign keys
 * (columns, target, referential actions). What is deliberately left out:
 *
 * - everything visual, and notes — documentation is not structure;
 * - **order**, of tables, columns and indexes: engines and drivers do not
 *   agree on one, and a schema read twice must hash the same;
 * - **names of indexes and constraints**: auto-generated ones differ from one
 *   database to the next for the same structure;
 * - **letter case** of identifiers, like the migration diff.
 *
 * It is strict on purpose where `diffTargetAgainstLive` is lenient: that diff
 * treats `varchar(255)` and `text` as the same type because it compares a
 * hand-written schema with what an engine reports; a fingerprint compares a
 * database with *itself* at another moment (or with its twin in another
 * environment), where `varchar(255)` becoming `varchar(320)` is exactly the
 * kind of change that must not be missed. Only spellings an engine itself uses
 * interchangeably are unified (`int4` / `integer`, `character varying` /
 * `varchar`…).
 */
export interface SchemaFingerprint {
  /** Bumped whenever the canonical form changes: fingerprints of different versions must not be compared. */
  version: 1;
  /** Hash of the whole schema: equal hashes, equal structure. */
  hash: string;
  /** Keyed by canonical table name (`schema.table`, lower-case). */
  tables: Record<string, TableFingerprint>;
}

export interface TableFingerprint {
  /** The name as written, for display. */
  name: string;
  hash: string;
  columns: ColumnFingerprint[];
  /** Sorted column names; empty when the table has no primary key. */
  primaryKey: string[];
  indexes: IndexFingerprint[];
  foreignKeys: ForeignKeyFingerprint[];
}

export interface ColumnFingerprint {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  increment: boolean;
}

export interface IndexFingerprint {
  /** In index order: `(a, b)` and `(b, a)` are different indexes. */
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyFingerprint {
  column: string;
  toTable: string;
  toColumn: string;
  onDelete: string;
  onUpdate: string;
}

export const FINGERPRINT_VERSION = 1;

/** One engine's two spellings of the same type. Left side as reported, right side canonical. */
const TYPE_ALIASES: Record<string, string> = {
  integer: "int",
  int4: "int",
  int8: "bigint",
  int2: "smallint",
  bool: "boolean",
  "character varying": "varchar",
  character: "char",
  bpchar: "char",
  float4: "real",
  float8: "double precision",
  double: "double precision",
  decimal: "numeric",
  timestamptz: "timestamp with time zone",
  "timestamp without time zone": "timestamp",
  timetz: "time with time zone",
  "time without time zone": "time",
};

/** `  Character Varying ( 255 )` → `varchar(255)`. */
export function canonicalType(type: string | undefined): string {
  const text = (type ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  const match = /^([^(]+?)\s*(\(.*\))?\s*(\[\])?$/.exec(text);
  if (!match) return text;
  const base = match[1].trim();
  const args = (match[2] ?? "").replace(/\s+/g, "");
  return `${TYPE_ALIASES[base] ?? base}${args}${match[3] ?? ""}`;
}

/**
 * `'active'::character varying`, `('active')` and `active` are one default.
 * Case is kept inside the value — `'Active'` and `'active'` are different
 * strings — but not for keywords and function names an engine reports in
 * whatever case it likes (`NOW()`, `CURRENT_TIMESTAMP`).
 */
export function canonicalDefault(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  let text = String(value).trim();
  if (text === "") return null;
  // A PostgreSQL cast suffix says nothing the column type does not.
  text = text.replace(/::[a-z_ ]+(\([^)]*\))?(\[\])?$/i, "").trim();
  while (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1).trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text.toLowerCase();
}

/** `NO ACTION` is what an engine does when nothing is said, so the two are one. */
function canonicalAction(action: RefAction | undefined): string {
  return !action || action === "no action" ? "" : action;
}

/**
 * Small, synchronous, and the same in the browser and in Node — which the Web
 * Crypto API is not. This is change detection, not security: nobody is
 * defended against by it, and 64 bits over a few hundred tables is far more
 * than chance needs. (cyrb53-style mix over two 32-bit halves.)
 */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

const lower = (text: string) => text.toLowerCase();
const tableKey = (table: Table) => lower(table.schemaName ? `${table.schemaName}.${table.name}` : table.name);

function fingerprintTable(table: Table, refs: Ref[], tablesById: Map<string, Table>): TableFingerprint {
  const columnName = (owner: Table | undefined, fieldId: string) =>
    lower(owner?.fields.find((field) => field.id === fieldId)?.name ?? fieldId);

  // A primary key is one thing whether it was declared on the column or as an index.
  const pkIndex = table.indexes.find((index) => index.pk);
  const primaryKey = (
    pkIndex
      ? pkIndex.fieldIds.map((id) => columnName(table, id))
      : table.fields.filter((field) => field.pk).map((field) => lower(field.name))
  ).sort();
  const isSolePk = (field: Field) => primaryKey.length === 1 && primaryKey[0] === lower(field.name);

  const columns = table.fields
    .map((field) => ({
      name: lower(field.name),
      type: canonicalType(field.type),
      // A primary-key column is NOT NULL whether or not anyone wrote it.
      notNull: Boolean(field.notNull) || primaryKey.includes(lower(field.name)),
      default: canonicalDefault(field.default),
      increment: Boolean(field.increment),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // A column-level `unique` is a one-column unique index; the same thing, said twice in some sources.
  const indexes = new Map<string, IndexFingerprint>();
  const addIndex = (columnNames: string[], unique: boolean) => {
    const key = `${columnNames.join(",")}:${unique}`;
    indexes.set(key, { columns: columnNames, unique });
  };
  for (const field of table.fields) if (field.unique && !isSolePk(field)) addIndex([lower(field.name)], true);
  for (const index of table.indexes) {
    if (index.pk) continue;
    addIndex(
      index.fieldIds.map((id) => columnName(table, id)),
      Boolean(index.unique),
    );
  }
  // A unique index on a column makes a separate plain index on it redundant to name.
  for (const [key, index] of indexes) {
    if (!index.unique && indexes.has(`${index.columns.join(",")}:true`)) indexes.delete(key);
  }

  const foreignKeys = refs
    .filter((ref) => ref.from.tableId === table.id)
    .map((ref) => {
      const target = tablesById.get(ref.to.tableId);
      return {
        column: columnName(table, ref.from.fieldId),
        toTable: target ? tableKey(target) : lower(ref.to.tableId),
        toColumn: columnName(target, ref.to.fieldId),
        onDelete: canonicalAction(ref.onDelete),
        onUpdate: canonicalAction(ref.onUpdate),
      };
    })
    .sort((a, b) => `${a.column}>${a.toTable}.${a.toColumn}`.localeCompare(`${b.column}>${b.toTable}.${b.toColumn}`));

  const body = {
    columns,
    primaryKey,
    indexes: [...indexes.values()].sort((a, b) =>
      `${a.columns.join(",")}:${a.unique}`.localeCompare(`${b.columns.join(",")}:${b.unique}`),
    ),
    foreignKeys,
  };
  return { name: table.name, hash: hashText(JSON.stringify(body)), ...body };
}

/** The canonical form of a schema — a project from the editor, or one read from a database. */
export function fingerprintSchema(schema: Pick<Project, "tables" | "refs">): SchemaFingerprint {
  const tablesById = new Map(schema.tables.map((table) => [table.id, table]));
  const tables: Record<string, TableFingerprint> = {};
  for (const table of [...schema.tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b)))) {
    tables[tableKey(table)] = fingerprintTable(table, schema.refs, tablesById);
  }
  const hash = hashText(
    Object.entries(tables)
      .map(([key, table]) => `${key}=${table.hash}`)
      .join(";"),
  );
  return { version: FINGERPRINT_VERSION, hash, tables };
}

export interface FingerprintDiff {
  /** Display names of tables only in `after`, only in `before`, and in both with a different hash. */
  added: string[];
  removed: string[];
  changed: string[];
  hasChanges: boolean;
}

/** What differs between two fingerprints, by table. Throws on a version mismatch rather than report a false "everything changed". */
export function diffFingerprints(before: SchemaFingerprint, after: SchemaFingerprint): FingerprintDiff {
  if (before.version !== after.version) {
    throw new Error(`fingerprint versions differ (${before.version} vs ${after.version})`);
  }
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  if (before.hash !== after.hash) {
    for (const [key, table] of Object.entries(after.tables)) {
      const previous = before.tables[key];
      if (!previous) added.push(table.name);
      else if (previous.hash !== table.hash) changed.push(table.name);
    }
    for (const [key, table] of Object.entries(before.tables)) {
      if (!after.tables[key]) removed.push(table.name);
    }
  }
  return { added, removed, changed, hasChanges: added.length + removed.length + changed.length > 0 };
}
