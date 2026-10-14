import type {
  DatabaseEngine,
  DbAdminColumn,
  DbAdminObjectRef,
  DbAdminQueryResult,
  DbAdminTableDescription,
  DbConsoleAccess,
  DbRowCell,
  DbRowColumnKind,
  DbRowColumnLock,
  DbRowEditColumn,
  DbRowEditCounts,
  DbRowEditRefusal,
  DbRowEditing,
  DbRowOperation,
} from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";
import { MAX_BINARY_BYTES, MAX_CELL_CHARS, quoteBacktick, quoteDouble, requireName } from "./drivers/common.js";
import type { RowStatementRunner } from "./drivers/interface.js";

/**
 * Row editing from the explorer's grid: a batch of typed operations on one
 * table, turned here — never by the client — into statements in the engine's
 * dialect, every value a bound parameter.
 *
 * - **Identity.** A row is its primary key, whole. No key, no editing: a
 *   SQLite `rowid` is not accepted in its place (a `VACUUM` may renumber it).
 * - **Values are text.** A cell travels as the engine's own text form or
 *   `null`, in both directions: the page is read with the engine converting
 *   each column to text, and written back with the engine converting the text
 *   to the column's type. No value goes through a JavaScript number.
 * - **Stale rows.** Before an `UPDATE` or a `DELETE` the row is read by its
 *   key and locked, and compared with what the request says was displayed:
 *   the edited columns for an update, every column for a delete. A row that
 *   is gone or shows another value refuses the batch.
 * - **One row.** Each statement must change exactly one row, or the batch is
 *   refused. Everything runs in one transaction: all of it, or nothing.
 *
 * The preview is `display` of the very statements that run — the same text,
 * with each parameter written out as a literal.
 */

export const MAX_ROW_OPERATIONS = 200;

/** Keys, original and new values of one batch, in UTF-8 bytes. */
export const MAX_ROW_EDIT_BYTES = 1024 * 1024;

type Classified = Pick<DbRowEditColumn, "kind" | "readOnly" | "booleanValues">;

interface RowDialect {
  quote(name: string): string;
  target(ref: DbAdminObjectRef): string;
  classify(type: string): Classified;
  /** A column as the grid's text, in a select list. Never more than the grid shows of a cell. */
  read(column: DbRowEditColumn): string;
  /** The placeholder of the `position`-th parameter, assigned to `column` or (`compared`) compared with it. */
  param(position: number, column: DbRowEditColumn, compared: boolean): string;
  /** Appended to the read that precedes a change, so the row stays as read until the transaction ends. */
  lock: string;
  /** What follows `INSERT INTO t` when no column is filled. */
  emptyInsert: string;
  /** A backslash in a string literal is an escape character. */
  backslashEscapes: boolean;
  /** Spellings a numeric column takes besides digits. */
  specialNumbers: RegExp | null;
  /** A boolean column is a small integer, and takes nothing else. */
  integerBooleans: boolean;
}

const kind = (value: DbRowColumnKind, readOnly: DbRowColumnLock | null = null): Classified => ({
  kind: value,
  readOnly,
});

/** One more than the grid shows, so a longer value is known to have been cut. */
const READ_CHARS = MAX_CELL_CHARS + 1;

const POSTGRES: RowDialect = {
  quote: quoteDouble,
  target: (ref) =>
    `${quoteDouble(requireName(ref.schema ?? "public", "schema"))}.${quoteDouble(requireName(ref.table, "table"))}`,
  classify(type) {
    const name = type.toLowerCase();
    // Arrays, enums, ranges, network addresses…: each has a text form the server reads back.
    if (name.endsWith("[]")) return kind("other");
    if (/^(smallint|integer|bigint|oid)$/.test(name)) return kind("integer");
    if (/^(numeric|decimal)\b/.test(name)) return kind("decimal");
    if (/^(real|double precision)$/.test(name)) return kind("float");
    if (name === "boolean") return { ...kind("boolean"), booleanValues: ["true", "false"] };
    if (/^(character|text|name|citext|uuid|"char")\b/.test(name)) return kind("text");
    if (/^(timestamp|date|time|interval)\b/.test(name)) return kind("datetime");
    if (/^jsonb?$/.test(name)) return kind("json");
    if (name === "bytea") return kind("binary", "binary");
    return kind("other");
  },
  read(column) {
    const c = quoteDouble(column.name);
    if (column.kind !== "binary") return `left(${c}::text, ${READ_CHARS})`;
    return (
      `'0x' || encode(substring(${c} from 1 for ${MAX_BINARY_BYTES}), 'hex') || ` +
      `CASE WHEN octet_length(${c}) > ${MAX_BINARY_BYTES} THEN '… (' || octet_length(${c}) || ' bytes)' ELSE '' END`
    );
  },
  // Untyped: the server gives the parameter the type of the column it is assigned to or compared with.
  param: (position) => `$${position}`,
  lock: " FOR UPDATE",
  emptyInsert: "DEFAULT VALUES",
  backslashEscapes: false,
  specialNumbers: /^[+-]?(nan|inf(inity)?)$/i,
  integerBooleans: false,
};

const MYSQL_GEOMETRY =
  /^(geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geomcollection|geometrycollection)\b/;

const MYSQL: RowDialect = {
  quote: quoteBacktick,
  // Unqualified: the session has selected the database.
  target: (ref) => quoteBacktick(requireName(ref.table, "table")),
  classify(type) {
    const name = type.toLowerCase();
    if (/^(tinyint\(1\)|bool)/.test(name)) return { ...kind("boolean"), booleanValues: ["1", "0"] };
    if (/^(tinyint|smallint|mediumint|int|integer|bigint|year)\b/.test(name)) return kind("integer");
    if (/^(decimal|numeric|dec|fixed)\b/.test(name)) return kind("decimal");
    if (/^(float|double|real)\b/.test(name)) return kind("float");
    if (/^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/.test(name)) return kind("text");
    if (/^(datetime|timestamp|date|time)\b/.test(name)) return kind("datetime");
    if (name === "json") return kind("json");
    if (/^(binary|varbinary|tinyblob|blob|mediumblob|longblob)\b/.test(name)) return kind("binary", "binary");
    // BIT, spatial types, vectors: a string assigned to one is not the value it spells.
    return kind("other", "unsupported");
  },
  read(column) {
    const c = quoteBacktick(column.name);
    const type = column.type.toLowerCase();
    if (column.kind === "binary") {
      return (
        `CONCAT('0x', LOWER(HEX(LEFT(${c}, ${MAX_BINARY_BYTES}))), ` +
        `IF(LENGTH(${c}) > ${MAX_BINARY_BYTES}, CONCAT('… (', LENGTH(${c}), ' bytes)'), ''))`
      );
    }
    if (column.kind === "text") return `LEFT(${c}, ${READ_CHARS})`;
    if (type.startsWith("bit")) return `CAST(${c} + 0 AS CHAR)`;
    if (MYSQL_GEOMETRY.test(type)) return `LEFT(ST_AsText(${c}), ${READ_CHARS})`;
    return `LEFT(CAST(${c} AS CHAR), ${READ_CHARS})`;
  },
  param(_position, column, compared) {
    // Assigned, a string is converted to the column's type digit for digit. Compared with a
    // number it would be read as a double, and two big keys could then compare equal.
    if (!compared) return "?";
    const type = column.type.toLowerCase();
    if (column.kind === "integer" || column.kind === "boolean") {
      return `CAST(? AS ${type.includes("unsigned") ? "UNSIGNED" : "SIGNED"})`;
    }
    if (column.kind === "decimal") {
      const [, precision, scale] = /\((\d+)(?:\s*,\s*(\d+))?\)/.exec(type) ?? [];
      return `CAST(? AS DECIMAL(${precision ?? 10}, ${scale ?? 0}))`;
    }
    return "?";
  },
  lock: " FOR UPDATE",
  emptyInsert: "() VALUES ()",
  backslashEscapes: true,
  specialNumbers: null,
  integerBooleans: true,
};

const SQLITE: RowDialect = {
  quote: quoteDouble,
  target: (ref) => quoteDouble(requireName(ref.table, "table")),
  // SQLite's own rules for the affinity of a declared type, in its order.
  classify(type) {
    const name = type.toUpperCase();
    if (name.includes("INT")) return kind("integer");
    if (/CHAR|CLOB|TEXT/.test(name)) return kind("text");
    if (name.includes("BLOB")) return kind("binary", "binary");
    // No affinity: text written to it stays text where a number was, with nothing to convert it back.
    if (name.trim() === "") return kind("other", "untyped");
    if (/REAL|FLOA|DOUB/.test(name)) return kind("float");
    // NUMERIC affinity from here on: the declared name only says what was meant.
    if (name.includes("BOOL")) return { ...kind("boolean"), booleanValues: ["1", "0"] };
    if (/DATE|TIME/.test(name)) return kind("datetime");
    if (name.includes("JSON")) return kind("json");
    if (/DEC|NUM/.test(name)) return kind("decimal");
    return kind("other");
  },
  // As stored: the value's own class is turned into text here, not by a cast that would round a real.
  read: (column) => quoteDouble(column.name),
  // The column's affinity converts a text parameter, in an assignment and in a comparison alike.
  param: () => "?",
  // The whole transaction holds the write lock (`BEGIN IMMEDIATE`).
  lock: "",
  emptyInsert: "DEFAULT VALUES",
  backslashEscapes: false,
  specialNumbers: null,
  // NUMERIC affinity: whatever is written is kept, as a number when it is one.
  integerBooleans: false,
};

/** The engines whose rows are edited. The others keep a read-only grid — see `describeRowEditing`. */
const DIALECTS: Partial<Record<DatabaseEngine, RowDialect>> = { postgres: POSTGRES, mysql: MYSQL, sqlite: SQLITE };

const INTEGER = /^[+-]?\d+$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function invalid(message: string, index?: number): ApiError {
  return new ApiError("ROW_EDIT_INVALID", { message, details: index === undefined ? undefined : { index } });
}

/**
 * What can be edited of a table, for this caller. Decided again on every
 * request: the grid only repeats it.
 */
export function describeRowEditing(
  engine: DatabaseEngine,
  description: DbAdminTableDescription,
  caller: { supported: boolean; access: DbConsoleAccess; readOnly: boolean },
): DbRowEditing {
  const dialect = caller.supported ? DIALECTS[engine] : undefined;
  const columns: DbRowEditColumn[] = description.columns.map((column: DbAdminColumn) => {
    const classified = dialect?.classify(column.type) ?? kind("other", "unsupported");
    return {
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      hasDefault: !column.generated && (column.defaultValue !== null || column.autoValue === true),
      primaryKey: column.primaryKey,
      ...classified,
      readOnly: column.generated ? "generated" : classified.readOnly,
    };
  });
  const key = columns.filter((column) => column.primaryKey);
  let reason: DbRowEditRefusal | null = null;
  if (caller.access === "read") reason = "read-access";
  else if (caller.readOnly) reason = "read-only-connection";
  else if (!dialect) reason = "engine";
  else if (key.length === 0) reason = "no-primary-key";
  // A generated key is still a key: it is compared, never written.
  else if (key.some((column) => column.readOnly !== null && column.readOnly !== "generated")) reason = "key-type";
  return {
    editable: reason === null,
    reason,
    key: key.map((column) => column.name),
    columns,
    maxOperations: MAX_ROW_OPERATIONS,
    maxBytes: MAX_ROW_EDIT_BYTES,
  };
}

/**
 * A value as the grid shows it and as a stale check compares it. `partial`:
 * not the whole value (cut short, or bytes shown as an excerpt).
 */
export function rowCellText(value: unknown): { text: DbRowCell; partial: boolean } {
  if (value === null || value === undefined) return { text: null, partial: false };
  if (typeof value === "string") {
    return value.length > MAX_CELL_CHARS
      ? { text: `${value.slice(0, MAX_CELL_CHARS)}…`, partial: true }
      : { text: value, partial: false };
  }
  if (typeof value === "number" || typeof value === "bigint") return { text: String(value), partial: false };
  if (typeof value === "boolean") return { text: value ? "true" : "false", partial: false };
  if (value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    const hex = buffer.subarray(0, MAX_BINARY_BYTES).toString("hex");
    return {
      text: `0x${hex}${buffer.length > MAX_BINARY_BYTES ? `… (${buffer.length} bytes)` : ""}`,
      partial: true,
    };
  }
  if (value instanceof Date)
    return { text: Number.isNaN(value.getTime()) ? null : value.toISOString(), partial: false };
  return rowCellText(JSON.stringify(value) ?? String(value));
}

function dialectOf(engine: DatabaseEngine): RowDialect {
  const dialect = DIALECTS[engine];
  if (!dialect) throw new ApiError("ROW_EDIT_NOT_EDITABLE", { details: { reason: "engine" } });
  return dialect;
}

function selectList(dialect: RowDialect, columns: DbRowEditColumn[]): string {
  return columns.map((column) => `${dialect.read(column)} AS ${dialect.quote(column.name)}`).join(", ");
}

/**
 * One page of an editable table: every cell as text, ordered by the primary
 * key so that a row stays where it was after it has been changed.
 */
export async function readEditablePage(
  run: RowStatementRunner,
  engine: DatabaseEngine,
  ref: DbAdminObjectRef,
  editing: DbRowEditing,
  page: { limit: number; offset: number },
): Promise<{ result: DbAdminQueryResult; partial: [number, number][] }> {
  const dialect = dialectOf(engine);
  const startedAt = Date.now();
  const res = await run(
    `SELECT ${selectList(dialect, editing.columns)} FROM ${dialect.target(ref)}` +
      ` ORDER BY ${editing.key.map(dialect.quote).join(", ")} LIMIT ${page.limit + 1} OFFSET ${page.offset}`,
  );
  const truncated = res.rows.length > page.limit;
  const partial: [number, number][] = [];
  const rows = (truncated ? res.rows.slice(0, page.limit) : res.rows).map((row, r) =>
    row.map((value, c) => {
      const cell = rowCellText(value);
      if (cell.partial) partial.push([r, c]);
      return cell.text;
    }),
  );
  return {
    result: {
      columns: editing.columns.map((column) => column.name),
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - startedAt,
    },
    partial,
  };
}

// ---- From operations to statements ---------------------------------------------

export interface RowStatement {
  /** Position of the operation in the request. */
  index: number;
  type: DbRowOperation["type"];
  sql: string;
  params: DbRowCell[];
  /** The same statement with its values written out: what is previewed, audited and counted. */
  display: string;
  /** The locking read that precedes an update or a delete, and what it has to return. */
  check: { sql: string; params: DbRowCell[]; columns: string[]; expected: DbRowCell[] } | null;
}

function literal(dialect: RowDialect, column: DbRowEditColumn, value: DbRowCell): string {
  if (value === null) return "NULL";
  if (["integer", "decimal", "float"].includes(column.kind) && NUMBER.test(value)) return value;
  if (column.kind === "boolean") {
    if (/^(true|false)$/i.test(value)) return value.toUpperCase();
    if (INTEGER.test(value)) return value;
  }
  const escaped = dialect.backslashEscapes ? value.replace(/\\/g, "\\\\") : value;
  return `'${escaped.replace(/'/g, "''")}'`;
}

/** Writes one statement twice from the same template: with placeholders to run, with literals to show. */
function statementPair(
  dialect: RowDialect,
  template: (value: (column: DbRowEditColumn, cell: DbRowCell, compared: boolean) => string) => string,
): { sql: string; params: DbRowCell[]; display: string } {
  const params: DbRowCell[] = [];
  const sql = template((column, cell, compared) => {
    params.push(cell);
    return dialect.param(params.length, column, compared);
  });
  return { sql, params, display: template((column, cell) => literal(dialect, column, cell)) };
}

function cells(
  value: unknown,
  what: string,
  index: number,
  columns: Map<string, DbRowEditColumn>,
): [DbRowEditColumn, DbRowCell][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${what} must be an object of column values`, index);
  }
  return Object.entries(value).map(([name, cell]) => {
    const column = columns.get(name);
    if (!column) throw invalid(`${what}: no such column: ${name}`, index);
    if (cell !== null && typeof cell !== "string") {
      throw invalid(`${what}: the value of ${name} must be text or null`, index);
    }
    return [column, cell];
  });
}

function checkWritable(dialect: RowDialect, column: DbRowEditColumn, cell: DbRowCell, index: number): void {
  if (column.readOnly) throw invalid(`column ${column.name} cannot be written (${column.readOnly})`, index);
  if (cell === null) return;
  // Checked here as well as by the database: not every engine refuses text in a numeric column.
  let wellFormed = true;
  if (column.kind === "integer" || (column.kind === "boolean" && dialect.integerBooleans)) {
    wellFormed = INTEGER.test(cell);
  } else if (column.kind === "decimal" || column.kind === "float") {
    wellFormed = NUMBER.test(cell) || Boolean(dialect.specialNumbers?.test(cell));
  }
  if (!wellFormed) throw invalid(`column ${column.name}: not a valid ${column.kind} value`, index);
}

/**
 * Validates a batch against the table and builds its statements, in the order
 * given. Touches no database: this is the dry run, and the plan that runs.
 */
export function planRowEdits(
  engine: DatabaseEngine,
  ref: DbAdminObjectRef,
  editing: DbRowEditing,
  operations: unknown,
): RowStatement[] {
  const dialect = dialectOf(engine);
  if (!Array.isArray(operations) || operations.length === 0) throw invalid("operations must be a non-empty array");
  if (operations.length > MAX_ROW_OPERATIONS) {
    throw new ApiError("ROW_EDIT_LIMIT", {
      details: { maxOperations: MAX_ROW_OPERATIONS, maxBytes: MAX_ROW_EDIT_BYTES },
    });
  }
  const columns = new Map(editing.columns.map((column) => [column.name, column]));
  const keyColumns = editing.key.map((name) => columns.get(name)!);
  const target = dialect.target(ref);
  const q = dialect.quote;
  const seen = new Set<string>();
  let bytes = 0;
  const weigh = (pairs: [DbRowEditColumn, DbRowCell][]) => {
    for (const [, cell] of pairs) bytes += cell === null ? 0 : Buffer.byteLength(cell);
  };

  const statements = operations.map((raw: unknown, index): RowStatement => {
    const operation = (raw ?? {}) as { type?: unknown; key?: unknown; original?: unknown; values?: unknown };
    if (operation.type !== "insert" && operation.type !== "update" && operation.type !== "delete") {
      throw invalid("type must be insert, update or delete", index);
    }
    const values = operation.type === "delete" ? [] : cells(operation.values, "values", index, columns);
    for (const [column, cell] of values) checkWritable(dialect, column, cell, index);
    weigh(values);

    if (operation.type === "insert") {
      const insert = statementPair(dialect, (value) =>
        values.length === 0
          ? `INSERT INTO ${target} ${dialect.emptyInsert}`
          : `INSERT INTO ${target} (${values.map(([column]) => q(column.name)).join(", ")}) ` +
            `VALUES (${values.map(([column, cell]) => value(column, cell, false)).join(", ")})`,
      );
      return { index, type: "insert", ...insert, check: null };
    }

    const key = new Map(cells(operation.key, "key", index, columns));
    if (key.size !== keyColumns.length || keyColumns.some((column) => typeof key.get(column) !== "string")) {
      throw invalid("key must give a value for each column of the primary key, and only those", index);
    }
    const identity = JSON.stringify(keyColumns.map((column) => key.get(column)));
    if (seen.has(identity)) throw invalid("the same row is changed twice in one batch", index);
    seen.add(identity);
    const original = cells(operation.original, "original", index, columns);
    weigh([...key.entries()]);
    weigh(original);

    const given = new Set(original.map(([column]) => column));
    const required = operation.type === "delete" ? editing.columns : values.map(([column]) => column);
    const missing = required.find((column) => !given.has(column));
    if (missing) {
      throw invalid(`original must carry the value ${missing.name} had when the row was read`, index);
    }
    if (operation.type === "update" && values.length === 0) throw invalid("an update needs at least one value", index);

    const where = (value: (column: DbRowEditColumn, cell: DbRowCell, compared: boolean) => string) =>
      keyColumns.map((column) => `${q(column.name)} = ${value(column, key.get(column)!, true)}`).join(" AND ");
    const check = statementPair(
      dialect,
      (value) =>
        `SELECT ${selectList(
          dialect,
          original.map(([column]) => column),
        )} FROM ${target} WHERE ${where(value)}${dialect.lock}`,
    );
    const change = statementPair(dialect, (value) =>
      operation.type === "delete"
        ? `DELETE FROM ${target} WHERE ${where(value)}`
        : `UPDATE ${target} SET ${values.map(([column, cell]) => `${q(column.name)} = ${value(column, cell, false)}`).join(", ")} ` +
          `WHERE ${where(value)}`,
    );
    return {
      index,
      type: operation.type,
      ...change,
      check: {
        sql: check.sql,
        params: check.params,
        columns: original.map(([column]) => column.name),
        expected: original.map(([, cell]) => cell),
      },
    };
  });

  if (bytes > MAX_ROW_EDIT_BYTES) {
    throw new ApiError("ROW_EDIT_LIMIT", {
      details: { maxOperations: MAX_ROW_OPERATIONS, maxBytes: MAX_ROW_EDIT_BYTES },
    });
  }
  return statements;
}

export function countRowEdits(statements: RowStatement[]): DbRowEditCounts {
  const counts: DbRowEditCounts = { insert: 0, update: 0, delete: 0 };
  for (const statement of statements) counts[statement.type] += 1;
  return counts;
}

/** How one statement that ran went — its locking read included in the time. */
export interface RowStatementOutcome {
  statement: RowStatement;
  success: boolean;
  durationMs: number;
}

/**
 * Runs a plan on a write session. Throws on the first statement that fails,
 * meets a stale row or does not change exactly one row — the session then
 * rolls everything back. `outcomes` receives what ran, for the statistics.
 */
export async function runRowEdits(
  run: RowStatementRunner,
  statements: RowStatement[],
  outcomes: RowStatementOutcome[],
): Promise<void> {
  for (const [position, statement] of statements.entries()) {
    const where = {
      index: statement.index,
      position: position + 1,
      total: statements.length,
      statement: statement.display,
    };
    const startedAt = Date.now();
    const done = (success: boolean) => outcomes.push({ statement, success, durationMs: Date.now() - startedAt });
    try {
      if (statement.check) {
        const { rows } = await run(statement.check.sql, statement.check.params);
        if (rows.length === 0)
          throw new ApiError("ROW_EDIT_STALE", { details: { ...where, missing: true, columns: [] } });
        if (rows.length > 1) throw new ApiError("ROW_EDIT_ROW_COUNT", { details: { ...where, affected: rows.length } });
        const changed = statement.check.columns.filter(
          (_, c) => rowCellText(rows[0][c]).text !== statement.check!.expected[c],
        );
        if (changed.length > 0) {
          throw new ApiError("ROW_EDIT_STALE", { details: { ...where, missing: false, columns: changed } });
        }
      }
      const { affected } = await run(statement.sql, statement.params);
      if (affected !== 1) throw new ApiError("ROW_EDIT_ROW_COUNT", { details: { ...where, affected } });
      done(true);
    } catch (err) {
      done(false);
      if (err instanceof ApiError) throw err;
      // The database's own words are the useful part: which constraint, which value.
      const reason = err instanceof Error ? err.message : String(err);
      throw new ApiError("ROW_EDIT_FAILED", {
        message: `statement ${where.position} of ${where.total} was refused by the database — ${reason}`,
        details: { ...where, reason },
      });
    }
  }
}
