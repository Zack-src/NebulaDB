/**
 * The few places a column's SQL is written by someone else's hand: its type (`varchar(10)`, `numeric(10,2)`) and
 * a default that is an expression (`now()`, `'{}'::jsonb`). Both go into the DDL as typed, and that DDL is
 * run against a real database by whoever deploys it — so a type of `int); DROP TABLE users; --` written by
 * a schema editor would run with the deployer's rights.
 *
 * A fragment is let through only when it is one expression: no statement separator, no comment, no line
 * break, quotes and parentheses that close. That covers everything a type or a default legitimately is.
 */
import type { Project } from "@nebuladb/shared";
import type { MigrationDialect } from "./dialect.js";

export class UnsafeSqlFragmentError extends Error {
  readonly code = "SQL_FRAGMENT_UNSAFE";
  constructor(
    readonly what: string,
    readonly fragment: string,
    readonly reason: string,
  ) {
    super(`${what} ${JSON.stringify(fragment.slice(0, 80))} cannot be used in generated SQL: ${reason}`);
    this.name = "UnsafeSqlFragmentError";
  }
}

/** Anything that ends a line or is invisible control text; a tab is the one that is fine. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/;

/** Index just past the quote closing the literal opened at `from`, or -1 when it never closes. */
function closingQuote(text: string, from: number, close: string, backslash: boolean): number {
  let i = from + 1;
  while (i < text.length) {
    if (backslash && text[i] === "\\") i += 2;
    else if (text[i] === close && text[i + 1] === close) i += 2;
    else if (text[i] === close) return i + 1;
    else i++;
  }
  return -1;
}

/** Returns `text` itself when it is a single expression, and throws otherwise. */
export function assertSafeSqlFragment(text: string, dialect: MigrationDialect, what: string): string {
  const refuse = (reason: string): never => {
    throw new UnsafeSqlFragmentError(what, text, reason);
  };
  if (CONTROL.test(text)) refuse("it contains a line break or a control character");

  const backslashDialect = dialect === "mysql" || dialect === "bigquery" || dialect === "clickhouse";
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "'" || c === '"' || c === "`" || (c === "[" && dialect === "mssql")) {
      const close = c === "[" ? "]" : c;
      // PostgreSQL's E'…' takes backslash escapes; every other string there does not.
      const escapeString =
        dialect === "postgres" && c === "'" && /^[eE]$/.test(text[i - 1] ?? "") && !/\w/.test(text[i - 2] ?? "");
      const end = closingQuote(text, i, close, c === "`" || c === "[" ? false : backslashDialect || escapeString);
      if (end === -1) refuse("a quote is never closed");
      i = end;
      continue;
    }
    if (c === ";") refuse("it contains a statement separator");
    if ((c === "-" && n === "-") || (c === "/" && n === "*") || (c === "*" && n === "/"))
      refuse("it contains a comment");
    if (c === "#" && backslashDialect) refuse("it contains a comment");
    if (dialect === "postgres" && c === "$" && /^\$[A-Za-z_]*\$/.test(text.slice(i)))
      refuse("it opens a dollar-quoted string");
    if (c === "(") depth++;
    if (c === ")" && --depth < 0) refuse("a parenthesis is closed that was never opened");
    i++;
  }
  if (depth !== 0) refuse("a parenthesis is never closed");
  return text;
}

/** Characters an identifier cannot carry into a generated script: every dialect's quote, an escape, a line break. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_NAME = /["'`[\]\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * A name (table, column, schema, index, relation, enum) that goes into a script. Most exporters wrap a name in the
 * dialect's quote without doubling a quote inside it, so a name that holds one ends the identifier early.
 */
export function assertSafeSqlName(name: string | undefined, what: string): void {
  if (name !== undefined && UNSAFE_NAME.test(name)) {
    throw new UnsafeSqlFragmentError(what, name, "a name cannot hold a quote, a bracket, a backslash or a line break");
  }
}

/** Refuses a project whose names, types or defaults would not survive being written into a script for `dialect`. */
export function assertSafeForSqlExport(project: Project, dialect: MigrationDialect): void {
  for (const table of project.tables) {
    assertSafeSqlName(table.name, "a table name");
    assertSafeSqlName(table.schemaName, "a schema name");
    for (const field of table.fields) {
      assertSafeSqlName(field.name, `a column name in ${table.name}`);
      assertSafeSqlFragment(field.type || "text", dialect, `the type of ${table.name}.${field.name}`);
      if (field.default && (field.defaultKind === undefined || field.defaultKind !== "string")) {
        // A string default is quoted by the exporter; anything else goes in as typed.
        const typed = field.default.trim();
        if (!typed.startsWith("'")) assertSafeSqlFragment(typed, dialect, `the default of ${table.name}.${field.name}`);
      }
    }
    for (const index of table.indexes) assertSafeSqlName(index.name, `an index name in ${table.name}`);
  }
  for (const ref of project.refs) assertSafeSqlName(ref.name, "a relation name");
  for (const entry of project.enums ?? []) {
    assertSafeSqlName(entry.name, "an enum name");
    for (const value of entry.values ?? []) assertSafeSqlName(value.name, `a value of ${entry.name}`);
  }
}
