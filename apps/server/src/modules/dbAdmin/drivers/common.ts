import type { DbAdminQueryResult, DbGrantScope, DbPrivilegeCatalog } from "@athanordb/shared";
import { ApiError } from "../../../shared/errors.js";
import type { AdminStatement } from "./interface.js";

const MAX_NAME_LENGTH = 128;
const MAX_CELL_CHARS = 10_000;
const MAX_BINARY_BYTES = 64;

/** A name that is about to be quoted into SQL: present, bounded, and free of the one character no quoting rule survives. */
export function requireName(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NAME_LENGTH || value.includes("\0")) {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: `${what} is required` });
  }
  return value;
}

export function optionalName(value: unknown, what: string): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : requireName(value, what);
}

export function quoteDouble(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function quoteBacktick(ident: string): string {
  return `\`${ident.replace(/`/g, "``")}\``;
}

export function quoteBracket(ident: string): string {
  return `[${ident.replace(/]/g, "]]")}]`;
}

/** Standard SQL string literal (PostgreSQL with `standard_conforming_strings`, SQL Server, Oracle, SQLite). */
export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export const MASK = "********";

export function plain(sql: string): AdminStatement {
  return { sql, display: sql };
}

export function unsupported(what: string): ApiError {
  return new ApiError("DB_ADMIN_UNSUPPORTED", { message: `${what} is not supported by this database engine` });
}

export function systemObject(what: string): ApiError {
  return new ApiError("DB_ADMIN_SYSTEM_OBJECT", {
    message: `${what} is a system object and cannot be modified from here`,
  });
}

/** Privileges are interpolated as keywords, so they are only ever taken from the engine's own fixed list. */
export function checkedPrivileges(catalog: DbPrivilegeCatalog, scope: DbGrantScope, requested: unknown): string[] {
  const allowed = catalog[scope];
  if (!allowed) throw unsupported(`granting at ${scope} level`);
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "at least one privilege is required" });
  }
  const privileges = requested.map((p) => String(p).toUpperCase());
  const unknown = privileges.find((p) => !allowed.includes(p));
  if (unknown)
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: `unknown privilege for this scope: ${unknown}` });
  return [...new Set(privileges)];
}

export function requirePassword(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0")) {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "a password is required" });
  }
  return value;
}

/** Whatever a driver hands back for a cell, as something JSON can carry and a grid can show. */
export function toJsonCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    const hex = buffer.subarray(0, MAX_BINARY_BYTES).toString("hex");
    return `0x${hex}${buffer.length > MAX_BINARY_BYTES ? `… (${buffer.length} bytes)` : ""}`;
  }
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
  } catch {
    return "[unreadable value]";
  }
}

export function toResult(
  columns: string[],
  rows: unknown[][],
  maxRows: number,
  startedAt: number,
  affected?: number,
): DbAdminQueryResult {
  const truncated = rows.length > maxRows;
  const kept = truncated ? rows.slice(0, maxRows) : rows;
  return {
    columns,
    rows: kept.map((row) => row.map(toJsonCell)),
    rowCount: columns.length === 0 && affected !== undefined ? affected : kept.length,
    truncated,
    durationMs: Date.now() - startedAt,
  };
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Strips the trailing `;` a person types out of habit, which several drivers reject. */
export function trimStatement(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}

export function requireInteger(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: `${what} must be a number` });
  return n;
}
