import { q, type MigrationDialect } from "@nebuladb/dbml-engine";
import { seedInsertOrder, type BackupCell, type DatabaseEngine, type Project, type Table } from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";
import type { RowValue } from "../connections/drivers/interface.js";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** `YYYY-MM-DD HH:MM:SS.mmm` in UTC — the one date spelling every engine here reads back from text. */
function dateToText(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`
  );
}

/**
 * What a driver handed back for a cell, as a backup keeps it: text, `null`,
 * or bytes. Nothing is shortened — unlike the console's grid, which is a
 * display — and a number is written with every digit it came with.
 */
export function toBackupCell(value: unknown): BackupCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return dateToText(value);
  if (value instanceof Uint8Array) return { $b: Buffer.from(value).toString("base64") };
  return JSON.stringify(value);
}

/** The reverse: what goes back into an `INSERT` as a bound parameter. */
export function fromBackupCell(cell: BackupCell): RowValue {
  if (cell === null || typeof cell === "string") return cell;
  return Buffer.from(cell.$b, "base64");
}

/**
 * One page of a table, in the target's dialect. Ordered by the primary key
 * when there is one, so pages neither overlap nor skip rows; a table without
 * one is read in whatever order the engine returns, which is only stable
 * while nobody writes to it.
 */
export function backupPageSql(
  engine: DatabaseEngine,
  table: string,
  columns: string[],
  primaryKey: string[],
  limit: number,
  offset: number,
): string {
  const dialect = engine as MigrationDialect;
  const select = `SELECT ${columns.map((c) => q(c, dialect)).join(", ")} FROM ${q(table, dialect)}`;
  const order = primaryKey.length > 0 ? ` ORDER BY ${primaryKey.map((c) => q(c, dialect)).join(", ")}` : "";
  if (engine === "mssql") {
    // `OFFSET … FETCH` is only valid after an `ORDER BY`; `(SELECT NULL)` is the documented way to have none.
    return `${select}${order || " ORDER BY (SELECT NULL)"} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }
  if (engine === "oracle") return `${select}${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  return `${select}${order} LIMIT ${limit} OFFSET ${offset}`;
}

/**
 * The tables a backup covers, parents before the tables whose foreign keys
 * point at them — the order a restore can insert them back in. `scope` names
 * tables (case-insensitive); a name the database does not have is refused
 * rather than silently left out of what is supposed to be a safety copy.
 */
export function tablesInBackupOrder(project: Project, scope: string[] | null): Table[] {
  let tables = project.tables.filter((table) => table.fields.length > 0);
  if (scope) {
    const byName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
    const unknown = scope.filter((name) => !byName.has(name.toLowerCase()));
    if (unknown.length > 0) {
      throw new ApiError("BACKUP_INVALID", {
        message: `no such table in this database: ${unknown.join(", ")}`,
        details: { unknownTables: unknown },
      });
    }
    tables = [...new Set(scope.map((name) => byName.get(name.toLowerCase())!))];
  }
  const byId = new Map(tables.map((table) => [table.id, table]));
  return seedInsertOrder([...byId.keys()], project.refs).order.map((id) => byId.get(id)!);
}
