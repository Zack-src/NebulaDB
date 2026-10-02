import type { DatabaseEngine } from "@athanordb/shared";
import { ApiError } from "../../shared/errors.js";

/**
 * The console's read-only mode, statement side. This is a guard rail for an
 * administrator who meant to look and not touch — not a sandbox. Where the
 * engine can enforce it itself it also does (a `READ ONLY` transaction on
 * PostgreSQL, MySQL and Oracle, a read-only file handle on SQLite); SQL
 * Server has no such thing, so there this check is all there is, and it is
 * correspondingly stricter.
 */

/** Statements that only read, by their first keyword. */
const READ_KEYWORDS = new Set(["SELECT", "WITH", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE"]);

/** `SELECT ... INTO` creates a table (SQL Server, PostgreSQL) or writes a server-side file (MySQL). */
const ALWAYS_FORBIDDEN = ["INTO"];

/** SQL Server runs a whole batch and needs no `;` between statements, so a keyword anywhere counts. */
const MSSQL_FORBIDDEN = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "REVOKE",
  "DENY",
  "BACKUP",
  "RESTORE",
  "SHUTDOWN",
  "KILL",
  "DBCC",
  "USE",
  "BULK",
  "OPENROWSET",
  "OPENQUERY",
  "OPENDATASOURCE",
  "WAITFOR",
  "RECONFIGURE",
  "SET",
];

/**
 * Blanks out everything that isn't code — comments, string literals, quoted
 * identifiers — so keyword checks can't be fooled by (or trip over) their
 * contents. Each is replaced by a single space or an empty quoted token.
 */
export function stripSqlNoise(sql: string, engine: DatabaseEngine): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
    } else if (ch === "#" && engine === "mysql") {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      out += " ";
    } else if (ch === "'" || ch === '"' || (ch === "`" && engine === "mysql")) {
      i++;
      while (i < n) {
        if (sql[i] === "\\" && engine === "mysql") i += 2;
        else if (sql[i] === ch && sql[i + 1] === ch) i += 2;
        else if (sql[i] === ch) break;
        else i++;
      }
      i++;
      out += " '' ";
    } else if (ch === "[" && engine === "mssql") {
      const end = sql.indexOf("]", i + 1);
      i = end === -1 ? n : end + 1;
      out += " '' ";
    } else if (ch === "$" && engine === "postgres") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? n : end + tag[0].length;
        out += " '' ";
      } else {
        out += ch;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function firstKeyword(stripped: string): string {
  return /^[\s(]*([A-Za-z]+)/.exec(stripped)?.[1]?.toUpperCase() ?? "";
}

/** True when the statement's result can be read through a cursor (PostgreSQL `DECLARE ... CURSOR FOR`). */
export function isRowReturningQuery(sql: string, engine: DatabaseEngine): boolean {
  return ["SELECT", "WITH", "VALUES", "TABLE"].includes(firstKeyword(stripSqlNoise(sql, engine)));
}

function writeNotAllowed(reason: string): ApiError {
  return new ApiError("DB_ADMIN_WRITE_NOT_ALLOWED", {
    message: `read-only mode: ${reason} — switch the console to write mode to run this statement`,
  });
}

/** Throws unless `sql` is a single statement that only reads. */
export function assertReadOnlyStatement(sql: string, engine: DatabaseEngine): void {
  // MySQL executes the body of a `/*! ... */` comment; nothing that only reads needs one.
  if (engine === "mysql" && sql.includes("/*!")) throw writeNotAllowed("executable comments are not allowed");

  const stripped = stripSqlNoise(sql, engine);
  const body = stripped.replace(/[;\s]+$/, "");
  if (body.includes(";")) throw writeNotAllowed("only one statement at a time");

  const keyword = firstKeyword(body);
  const allowed = READ_KEYWORDS.has(keyword) || (engine === "sqlite" && keyword === "PRAGMA");
  if (!allowed) throw writeNotAllowed(keyword ? `${keyword} statements are not allowed` : "the statement is empty");

  const forbidden = engine === "mssql" ? [...ALWAYS_FORBIDDEN, ...MSSQL_FORBIDDEN] : ALWAYS_FORBIDDEN;
  const tokens = new Set(body.toUpperCase().match(/[A-Z_]+/g) ?? []);
  const hit = forbidden.find((word) => tokens.has(word));
  if (hit) throw writeNotAllowed(`${hit} is not allowed`);
}
