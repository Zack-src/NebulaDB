import type { DatabaseEngine, StructuralAction } from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";

/**
 * The console's read-only mode, statement side. This is a guard rail for an
 * administrator who meant to look and not touch — not a sandbox. Where the
 * engine can enforce it itself it also does (a `READ ONLY` transaction on
 * PostgreSQL, MySQL and Oracle, a read-only file handle on SQLite); SQL
 * Server and BigQuery have no such thing, so there this check is all there
 * is, and it is correspondingly stricter: a whitelist of the reserved words a
 * query may use rather than a list of the ones it may not.
 */

/** Statements that only read, by their first keyword. */
const READ_KEYWORDS = new Set(["SELECT", "WITH", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE"]);

/** Where the whitelist applies, a query starts with one of these. */
const STRICT_READ_KEYWORDS = new Set(["SELECT", "WITH"]);

/** `SELECT ... INTO` creates a table (SQL Server, PostgreSQL) or writes a server-side file (MySQL). */
const ALWAYS_FORBIDDEN = ["INTO"];

/** MySQL writes server-side files with these, wherever they sit. */
const MYSQL_FORBIDDEN = ["OUTFILE", "DUMPFILE"];

/**
 * T-SQL's reserved keywords. A batch needs no `;` between statements, and
 * every statement but a procedure call (first in the batch only) starts with
 * a keyword, almost always a reserved one — which, as an identifier, has to be
 * quoted. So: any reserved word a read has no use for means the text is
 * something else, whatever comes before it.
 */
const MSSQL_RESERVED = new Set(
  `ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK
  CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE
  CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC
  DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE
  EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL
  FUNCTION GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT
  INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF
  OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN
  PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION
  RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT
  SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE SEMANTICSIMILARITYTABLE SESSION_USER SET SETUSER
  SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE
  TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE
  WHILE WITH WITHIN WRITETEXT`.split(/\s+/),
);

/** The reserved words a T-SQL query that only reads may use. */
const MSSQL_READ_ALLOWED = new Set(
  `ALL AND ANY AS ASC BETWEEN BY CASE COALESCE COLLATE CONTAINS CONTAINSTABLE CONVERT CROSS CURRENT_DATE
  CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DESC DISTINCT DOUBLE ELSE END ESCAPE EXCEPT EXISTS FETCH FOR
  FREETEXT FREETEXTTABLE FROM FULL GROUP HAVING HOLDLOCK IDENTITYCOL IN INDEX INNER INTERSECT IS JOIN LEFT LIKE
  NATIONAL NOT NULL NULLIF ON OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PRECISION RIGHT ROWGUIDCOL SELECT
  SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE SEMANTICSIMILARITYTABLE SESSION_USER SOME SYSTEM_USER
  TABLESAMPLE THEN TOP TRY_CONVERT UNION UNPIVOT USER VALUES VARYING WHEN WHERE WITH WITHIN`.split(/\s+/),
);

/** …and a member's data write: the read words, plus what an `INSERT`, `UPDATE`, `DELETE` or `MERGE` takes. */
const MSSQL_WRITE_ALLOWED = new Set([...MSSQL_READ_ALLOWED, "INSERT", "UPDATE", "DELETE", "MERGE", "INTO", "SET", "DEFAULT"]);

/** T-SQL statements that start with a word that is *not* reserved (Service Broker, trigger switches). */
const MSSQL_UNRESERVED_STATEMENTS = ["RECEIVE", "SEND", "CONVERSATION", "ENABLE", "DISABLE"];

/** GoogleSQL's reserved keywords. */
const BIGQUERY_RESERVED = new Set(
  `ALL AND ANY ARRAY AS ASC ASSERT_ROWS_MODIFIED AT BETWEEN BY CASE CAST COLLATE CONTAINS CREATE CROSS CUBE
  CURRENT DEFAULT DEFINE DESC DISTINCT ELSE END ENUM ESCAPE EXCEPT EXCLUDE EXISTS EXTRACT FALSE FETCH FOLLOWING
  FOR FROM FULL GROUP GROUPING GROUPS HASH HAVING IF IGNORE IN INNER INTERSECT INTERVAL INTO IS JOIN LATERAL LEFT
  LIKE LIMIT LOOKUP MERGE NATURAL NEW NO NOT NULL NULLS OF ON OR ORDER OUTER OVER PARTITION PRECEDING PROTO
  QUALIFY RANGE RECURSIVE RESPECT RIGHT ROLLUP ROWS SELECT SET SOME STRUCT TABLESAMPLE THEN TO TREAT TRUE
  UNBOUNDED UNION UNNEST USING WHEN WHERE WINDOW WITH WITHIN`.split(/\s+/),
);

/** The reserved words a GoogleSQL query that only reads may use: all of them but these. */
const BIGQUERY_READ_ALLOWED = new Set(
  [...BIGQUERY_RESERVED].filter(
    (word) => !["ASSERT_ROWS_MODIFIED", "CREATE", "DEFAULT", "DEFINE", "INTO", "MERGE", "SET"].includes(word),
  ),
);

/** GoogleSQL statements that start with an unreserved word. One statement is already enforced; belt and braces. */
const BIGQUERY_UNRESERVED_STATEMENTS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "DROP",
  "ALTER",
  "UNDROP",
  "EXPORT",
  "LOAD",
  "CALL",
  "EXECUTE",
  "IMMEDIATE",
  "BEGIN",
  "DECLARE",
  "GRANT",
  "REVOKE",
];

// ---- Lexing -------------------------------------------------------------------

/**
 * What the server's settings decide about lexing, which the console cannot
 * know: a statement must be safe under each possibility.
 */
interface LexMode {
  /** `\` escapes in `'…'` (MySQL by default; PostgreSQL with `standard_conforming_strings` off). */
  backslashInSingle: boolean;
  /** `\` escapes in `"…"` (MySQL, unless `ANSI_QUOTES` makes them identifiers). */
  backslashInDouble: boolean;
  /**
   * PostgreSQL before 15/16: `1e'…'` is `1` then an `E'…'` string, and `0x1F` is `0` then an
   * identifier; later servers reject the first and read the second as a number.
   */
  oldNumbers: boolean;
}

function lexModes(engine: DatabaseEngine): LexMode[] {
  if (engine === "postgres") {
    return [false, true].flatMap((backslashInSingle) =>
      [false, true].map((oldNumbers) => ({ backslashInSingle, backslashInDouble: false, oldNumbers })),
    );
  }
  if (engine === "mysql") {
    // NO_BACKSLASH_ESCAPES turns both off; ANSI_QUOTES only the second.
    return [
      { backslashInSingle: true, backslashInDouble: true, oldNumbers: false },
      { backslashInSingle: false, backslashInDouble: false, oldNumbers: false },
      { backslashInSingle: true, backslashInDouble: false, oldNumbers: false },
    ];
  }
  return [{ backslashInSingle: false, backslashInDouble: false, oldNumbers: false }];
}

/** Characters that continue an identifier or a number (Oracle also takes `#`). */
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const ORACLE_IDENT_CHAR = /[A-Za-z0-9_$#\u0080-\uffff]/;
const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;
const ORACLE_Q_CLOSE: Record<string, string> = { "[": "]", "{": "}", "<": ">", "(": ")" };

/** PostgreSQL: is this run of identifier characters a whole number or parameter, after which a new token starts? */
function isPostgresNumber(run: string, oldNumbers: boolean): boolean {
  if (/^\$\d+$/.test(run)) return true;
  if (oldNumbers) return /^\d+(?:[eE]\d+)?$/.test(run);
  return /^(?:\d[\d_]*(?:[eE]\d+)?|0[xX][\dA-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+)$/.test(run);
}

/**
 * Index just past the quote closing a literal opened before `from`. Unterminated: the end of
 * the text. `doubled`: a doubled quote is one quote inside (read as two adjacent literals
 * instead, it covers the same text — except where a triple quote means something else).
 */
function quotedEnd(sql: string, from: number, quote: string, backslash: boolean, doubled = true): number {
  let i = from;
  while (i < sql.length) {
    if (backslash && sql[i] === "\\") i += 2;
    else if (sql.startsWith(quote, i)) {
      if (doubled && quote.length === 1 && sql[i + 1] === quote) i += 2;
      else return i + quote.length;
    } else i++;
  }
  return sql.length;
}

function blockCommentEnd(sql: string, from: number, nested: boolean): number {
  let depth = 1;
  let i = from;
  while (i < sql.length) {
    if (nested && sql[i] === "/" && sql[i + 1] === "*") {
      depth++;
      i += 2;
    } else if (sql[i] === "*" && sql[i + 1] === "/") {
      i += 2;
      if (--depth === 0) return i;
    } else i++;
  }
  return sql.length;
}

function lineCommentEnd(sql: string, from: number): number {
  const end = sql.indexOf("\n", from);
  return end === -1 ? sql.length : end;
}

/** Where the literal or quoted identifier opening at `i` ends, or -1 if none opens there. */
function literalEnd(sql: string, i: number, engine: DatabaseEngine, mode: LexMode, run: string): number {
  const ch = sql[i];
  switch (engine) {
    case "postgres":
      if (ch === "'") {
        const escapeString = /^[eE]$/.test(run) || (mode.oldNumbers && /^\d+[eE]$/.test(run));
        return quotedEnd(sql, i + 1, "'", mode.backslashInSingle || escapeString);
      }
      if (ch === '"') return quotedEnd(sql, i + 1, '"', false);
      if (ch === "$") {
        DOLLAR_TAG.lastIndex = i;
        const tag = DOLLAR_TAG.exec(sql)?.[0];
        if (!tag) return -1;
        // Glued to an identifier, `$` is part of it (`q$z$`); after a number or a parameter, a quote opens.
        if (run && (IDENT_START.test(run[0]) || !isPostgresNumber(run, mode.oldNumbers))) return -1;
        const end = sql.indexOf(tag, i + tag.length);
        return end === -1 ? sql.length : end + tag.length;
      }
      return -1;
    case "mysql":
      if (ch === "'") return quotedEnd(sql, i + 1, "'", mode.backslashInSingle);
      if (ch === '"') return quotedEnd(sql, i + 1, '"', mode.backslashInDouble);
      // No escape inside backticks, only a doubled one.
      if (ch === "`") return quotedEnd(sql, i + 1, "`", false);
      return -1;
    case "mssql":
      if (ch === "'" || ch === '"') return quotedEnd(sql, i + 1, ch, false);
      if (ch === "[") return quotedEnd(sql, i + 1, "]", false);
      return -1;
    case "sqlite":
      if (ch === "'" || ch === '"' || ch === "`") return quotedEnd(sql, i + 1, ch, false);
      if (ch === "[") {
        const end = sql.indexOf("]", i + 1);
        return end === -1 ? sql.length : end + 1;
      }
      return -1;
    case "oracle":
      if (ch === "'" && /^\d*[nN]?[qQ]$/.test(run)) {
        // q'[ … ]' — alternative quoting: no escapes, closed by the delimiter's pair and a quote.
        const open = sql[i + 1];
        if (open !== undefined && !/\s/.test(open)) {
          const close = (ORACLE_Q_CLOSE[open] ?? open) + "'";
          const end = sql.indexOf(close, i + 2);
          return end === -1 ? sql.length : end + 2;
        }
      }
      if (ch === "'" || ch === '"') return quotedEnd(sql, i + 1, ch, false);
      return -1;
    case "bigquery":
      // GoogleSQL: `\` escapes everywhere (a raw string still cannot end on `\'`), no doubling, triple quotes.
      if (ch === "'" || ch === '"') {
        const triple = ch.repeat(3);
        if (sql.startsWith(triple, i)) return quotedEnd(sql, i + 3, triple, true, false);
        return quotedEnd(sql, i + 1, ch, true, false);
      }
      if (ch === "`") return quotedEnd(sql, i + 1, "`", true, false);
      return -1;
  }
}

function stripWith(sql: string, engine: DatabaseEngine, mode: LexMode): string {
  let out = "";
  let i = 0;
  /** Start of the run of identifier characters just before `i`, or -1. */
  let runStart = -1;
  const n = sql.length;
  const identChar = engine === "oracle" ? ORACLE_IDENT_CHAR : IDENT_CHAR;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    let end = -1;
    let literal = false;
    if (ch === "-" && next === "-") {
      // MySQL only takes `--` for a comment when a blank follows: `1 --1` is `1 - -1`.
      if (engine !== "mysql" || i + 2 >= n || sql.charCodeAt(i + 2) <= 0x20) end = lineCommentEnd(sql, i);
    } else if (ch === "#" && (engine === "mysql" || engine === "bigquery")) {
      end = lineCommentEnd(sql, i);
    } else if (ch === "/" && next === "*") {
      end = blockCommentEnd(sql, i + 2, engine === "postgres" || engine === "mssql");
    } else {
      end = literalEnd(sql, i, engine, mode, runStart === -1 ? "" : sql.slice(runStart, i));
      literal = true;
    }
    if (end === -1) {
      out += ch;
      if (identChar.test(ch)) {
        if (runStart === -1) runStart = i;
      } else runStart = -1;
      i++;
    } else {
      out += literal ? " '' " : " ";
      runStart = -1;
      i = end;
    }
  }
  return out;
}

/**
 * Blanks out everything that isn't code — comments, string literals, quoted
 * identifiers — so keyword checks can't be fooled by (or trip over) their
 * contents. Each is replaced by a single space or an empty quoted token.
 * Follows each engine's own rules (`#` comments, nested block comments, `E'…'`,
 * dollar quotes, `[…]`, `q'[…]'`, triple quotes…), under its default settings.
 */
export function stripSqlNoise(sql: string, engine: DatabaseEngine): string {
  return stripWith(sql, engine, lexModes(engine)[0]);
}

/** The text with noise stripped under every lexing the server's settings allow. */
function strippedVariants(sql: string, engine: DatabaseEngine): string[] {
  return [...new Set(lexModes(engine).map((mode) => stripWith(sql, engine, mode)))];
}

/** The words of stripped SQL, upper-cased. SQL Server variables and temporary tables are not keywords. */
function wordsOf(stripped: string, engine: DatabaseEngine): string[] {
  const upper = stripped.toUpperCase();
  if (engine === "mssql") return (upper.match(/[@#]*[A-Z_][A-Z0-9_$@#]*/g) ?? []).filter((w) => !/^[@#]/.test(w));
  return upper.match(/[A-Z_][A-Z0-9_$]*/g) ?? [];
}

// MySQL runs the body of a `/*! … */` comment, MariaDB that of `/*M! … */`.
const EXECUTABLE_COMMENT = /\/\*[Mm]?!/;

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

/** The first word of `words` that is reserved without being allowed, or listed as forbidden. */
function outsideWhitelist(
  words: string[],
  reserved: Set<string>,
  allowed: Set<string>,
  forbidden: string[],
): string | undefined {
  return words.find((word) => (reserved.has(word) && !allowed.has(word)) || forbidden.includes(word));
}

function checkReadOnly(stripped: string, engine: DatabaseEngine): void {
  const body = stripped.replace(/[;\s]+$/, "");
  if (body.includes(";")) throw writeNotAllowed("only one statement at a time");

  const keyword = firstKeyword(body);
  const strict = engine === "mssql" || engine === "bigquery";
  const allowed = strict
    ? STRICT_READ_KEYWORDS.has(keyword)
    : READ_KEYWORDS.has(keyword) || (engine === "sqlite" && keyword === "PRAGMA");
  if (!allowed) throw writeNotAllowed(keyword ? `${keyword} statements are not allowed` : "the statement is empty");

  const words = wordsOf(body, engine);
  const forbidden = engine === "mysql" ? [...ALWAYS_FORBIDDEN, ...MYSQL_FORBIDDEN] : ALWAYS_FORBIDDEN;
  let hit = words.find((word) => forbidden.includes(word));
  if (!hit && engine === "mssql") {
    hit = outsideWhitelist(words, MSSQL_RESERVED, MSSQL_READ_ALLOWED, MSSQL_UNRESERVED_STATEMENTS);
  }
  if (!hit && engine === "bigquery") {
    hit = outsideWhitelist(words, BIGQUERY_RESERVED, BIGQUERY_READ_ALLOWED, BIGQUERY_UNRESERVED_STATEMENTS);
  }
  if (hit) throw writeNotAllowed(`${hit} is not allowed`);
}

/** Throws unless `sql` is a single statement that only reads. */
export function assertReadOnlyStatement(sql: string, engine: DatabaseEngine): void {
  // Nothing that only reads needs an executable comment.
  if (engine === "mysql" && EXECUTABLE_COMMENT.test(sql)) throw writeNotAllowed("executable comments are not allowed");
  for (const stripped of strippedVariants(sql, engine)) checkReadOnly(stripped, engine);
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
  "TRIGGER",
  "WRITETEXT",
  "UPDATETEXT",
  "SETUSER",
  "CHECKPOINT",
  ...MSSQL_UNRESERVED_STATEMENTS,
];

function dataWriteNotAllowed(reason: string): ApiError {
  return new ApiError("DB_ACCESS_STATEMENT_NOT_ALLOWED", {
    message: `only one data statement (INSERT, UPDATE, DELETE, MERGE) can be run with your access: ${reason}`,
  });
}

/** `true` when the statement turned out to be a read, to be held to the read-only rules. */
function checkData(stripped: string, engine: DatabaseEngine): boolean {
  const body = stripped.replace(/[;\s]+$/, "");
  if (body.includes(";")) throw dataWriteNotAllowed("one statement at a time");

  const keyword = firstKeyword(body);
  if (READ_KEYWORDS.has(keyword) && keyword !== "WITH") return true;
  if (!DATA_WRITE_KEYWORDS.has(keyword) || (keyword === "REPLACE" && engine !== "mysql")) {
    throw dataWriteNotAllowed(keyword ? `${keyword} statements are not allowed` : "the statement is empty");
  }

  const tokens = wordsOf(body, engine);
  const words = new Set(tokens);
  let hit = DATA_WRITE_FORBIDDEN.find((word) => words.has(word));
  if (!hit && engine === "mssql") hit = outsideWhitelist(tokens, MSSQL_RESERVED, MSSQL_WRITE_ALLOWED, []);
  if (hit) throw dataWriteNotAllowed(`${hit} is not allowed`);

  // `INSERT INTO` / `MERGE INTO` / `REPLACE INTO` take one `INTO`; a second,
  // or one in an `UPDATE` / `DELETE`, is a `SELECT … INTO` making a table.
  const intos = tokens.filter((token) => token === "INTO").length;
  const allowedIntos = tokens.some((token) => token === "INSERT" || token === "MERGE" || token === "REPLACE") ? 1 : 0;
  if (intos > allowedIntos) throw dataWriteNotAllowed("SELECT … INTO is not allowed");

  if (structuralIn(stripped, engine).length > 0) throw dataWriteNotAllowed("structure goes through the schema");
  return false;
}

/**
 * Throws unless `sql` is one statement that writes **data**: what a member granted `write`
 * may run. Stricter than the administrator's write mode: one statement, a known first keyword,
 * nothing that changes structure, accounts or the server, no `SELECT ... INTO`.
 *
 * A guard rail, not a sandbox: the database's own permissions are the real bound.
 */
export function assertDataStatement(sql: string, engine: DatabaseEngine): void {
  if (engine === "mysql" && EXECUTABLE_COMMENT.test(sql)) {
    throw dataWriteNotAllowed("executable comments are not allowed");
  }
  let read = false;
  for (const stripped of strippedVariants(sql, engine)) read = checkData(stripped, engine) || read;
  // A read sent in write mode: held to the read-only rules.
  if (read) assertReadOnlyStatement(sql, engine);
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

function structuralIn(stripped: string, engine: DatabaseEngine): StructuralAction[] {
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
  return structuralIn(stripSqlNoise(sql, engine), engine);
}
