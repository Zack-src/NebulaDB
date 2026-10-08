import type { DatabaseEngine, StructuralAction } from "@nebuladb/shared";
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
    } else if (ch === "'" || ch === '"' || (ch === "`" && (engine === "mysql" || engine === "bigquery"))) {
      i++;
      while (i < n) {
        if (sql[i] === "\\" && (engine === "mysql" || engine === "bigquery")) i += 2;
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

function firstKeyword(stripped: string): string {
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

// ---- Data writes by a member (database access granted at `write`) -------------

/** What a member with `write` access may start a statement with. */
const DATA_WRITE_KEYWORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "WITH", "REPLACE"]);

/**
 * Words that have no business in a data write, anywhere in it: structure,
 * accounts and permissions, procedure calls (which can do any of those),
 * server-side files and session or server control. A column that happens to
 * carry one of these names has to be quoted.
 */
const DATA_WRITE_FORBIDDEN = [
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "RENAME",
  "COMMENT",
  "GRANT",
  "REVOKE",
  "DENY",
  "EXEC",
  "EXECUTE",
  "CALL",
  "COPY",
  "LOAD",
  "OUTFILE",
  "DUMPFILE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
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
  "RECONFIGURE",
  "WAITFOR",
  "LOCK",
  "HANDLER",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "BEGIN",
];

function dataWriteNotAllowed(reason: string): ApiError {
  return new ApiError("DB_ACCESS_STATEMENT_NOT_ALLOWED", {
    message: `only one data statement (INSERT, UPDATE, DELETE, MERGE) can be run with your access: ${reason}`,
  });
}

/**
 * Throws unless `sql` is one statement that writes **data**: what a member granted `write`
 * may run. Stricter than the administrator's write mode: one statement, a known first keyword,
 * nothing that changes structure, accounts or the server, no `SELECT ... INTO`.
 *
 * A guard rail, not a sandbox: the database's own permissions are the real bound.
 */
export function assertDataStatement(sql: string, engine: DatabaseEngine): void {
  if (engine === "mysql" && sql.includes("/*!")) throw dataWriteNotAllowed("executable comments are not allowed");

  const stripped = stripSqlNoise(sql, engine);
  const body = stripped.replace(/[;\s]+$/, "");
  if (body.includes(";")) throw dataWriteNotAllowed("one statement at a time");

  const keyword = firstKeyword(body);
  if (READ_KEYWORDS.has(keyword) && keyword !== "WITH") {
    // A read sent in write mode: held to the read-only rules.
    assertReadOnlyStatement(sql, engine);
    return;
  }
  if (!DATA_WRITE_KEYWORDS.has(keyword) || (keyword === "REPLACE" && engine !== "mysql")) {
    throw dataWriteNotAllowed(keyword ? `${keyword} statements are not allowed` : "the statement is empty");
  }

  const tokens = body.toUpperCase().match(/[A-Z_]+/g) ?? [];
  const words = new Set(tokens);
  const hit = DATA_WRITE_FORBIDDEN.find((word) => words.has(word));
  if (hit) throw dataWriteNotAllowed(`${hit} is not allowed`);

  // `INSERT INTO` / `MERGE INTO` / `REPLACE INTO` take one `INTO`; a second,
  // or one in an `UPDATE` / `DELETE`, is a `SELECT … INTO` making a table.
  const intos = tokens.filter((token) => token === "INTO").length;
  const allowedIntos = tokens.some((token) => token === "INSERT" || token === "MERGE" || token === "REPLACE") ? 1 : 0;
  if (intos > allowedIntos) throw dataWriteNotAllowed("SELECT … INTO is not allowed");

  if (findStructuralStatements(sql, engine).length > 0) throw dataWriteNotAllowed("structure goes through the schema");
}

// ---- Structural statements ---------------------------------------------------

/** Words that may sit between `CREATE` and `TABLE` / `INDEX`. */
const CREATE_MODIFIERS =
  "OR\\s+REPLACE|UNIQUE|CLUSTERED|NONCLUSTERED|FULLTEXT|SPATIAL|BITMAP|COLUMNSTORE|GLOBAL|LOCAL|TEMP|TEMPORARY|UNLOGGED|VIRTUAL";
const STRUCTURAL = `(CREATE|ALTER|DROP)\\s+((?:(?:${CREATE_MODIFIERS})\\s+)*)(TABLE|INDEX)\\b[ \\t]*([^;\\n]*)`;
const STRUCTURAL_AT_START = new RegExp(`^[\\s(]*${STRUCTURAL}`, "i");
const STRUCTURAL_ANYWHERE = new RegExp(`\\b${STRUCTURAL}`, "gi");
/** MySQL's `RENAME TABLE a TO b`. */
const RENAME_AT_START = /^\s*RENAME\s+TABLE\b\s*([^;]*)/i;
/** Noise between the object keyword and its name. */
const NAME_PREFIX = /^(?:IF\s+(?:NOT\s+)?EXISTS|ONLY|CONCURRENTLY)\s+/i;
/** Granting the *right* to create tables is a permission change, not a structural one. */
const PERMISSION_STATEMENT = /^\s*(GRANT|REVOKE|DENY)\b/i;

function objectName(rest: string): string | null {
  let text = rest.trimStart();
  while (NAME_PREFIX.test(text)) text = text.replace(NAME_PREFIX, "");
  // A quoted name was blanked by `stripSqlNoise`; better no name than a wrong one.
  return /^[A-Za-z_#@][\w$#@.]*/.exec(text)?.[0] ?? null;
}

function toAction(verb: string, modifiers: string, kind: string, rest: string): StructuralAction | null {
  const object = objectName(rest);
  // A temporary table lives and dies with the session: it is not the schema.
  // (Oracle's GLOBAL TEMPORARY table is a permanent definition, and is.)
  const temporary = /\b(TEMP|TEMPORARY)\b/i.test(modifiers) && !/\bGLOBAL\b/i.test(modifiers);
  if (temporary || object?.startsWith("#")) return null;
  return {
    verb: verb.toLowerCase() as StructuralAction["verb"],
    kind: kind.toLowerCase() as StructuralAction["kind"],
    object,
  };
}

/**
 * The statements in `sql` that change what the *schema editor* models: tables
 * (so columns and constraints too, through `ALTER TABLE`) and indexes. Empty
 * for anything else — data statements, and also views, functions, triggers
 * and whole databases, which a project cannot describe and so cannot be asked
 * to own.
 *
 * Like the read-only check above, a guard rail for someone working in good
 * faith, not a parser and not a sandbox: DDL built inside a procedure, a `DO`
 * block or `EXEC('…')` is not seen.
 */
export function findStructuralStatements(sql: string, engine: DatabaseEngine): StructuralAction[] {
  const stripped = stripSqlNoise(sql, engine);
  const actions: StructuralAction[] = [];
  for (const statement of stripped.split(";")) {
    if (PERMISSION_STATEMENT.test(statement)) continue;
    const rename = RENAME_AT_START.exec(statement);
    if (rename) {
      actions.push({ verb: "rename", kind: "table", object: objectName(rename[1]) });
      continue;
    }
    // SQL Server runs a batch with no `;` between statements, so the first
    // keyword of the "statement" says nothing about the rest of it.
    const matches =
      engine === "mssql"
        ? Array.from(statement.matchAll(STRUCTURAL_ANYWHERE))
        : [STRUCTURAL_AT_START.exec(statement)].filter((match) => match !== null);
    for (const match of matches) {
      const action = toAction(match[1], match[2], match[3], match[4]);
      if (action) actions.push(action);
    }
  }
  return actions;
}
