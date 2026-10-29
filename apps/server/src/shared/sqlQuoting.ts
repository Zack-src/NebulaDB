/**
 * Pure SQL text helpers shared by both driver hierarchies
 * (`modules/connections/drivers` and `modules/dbAdmin/drivers`) and by the
 * few server files that build SQL by hand. No I/O, no engine client.
 */

/** How long a driver waits for a target to accept a connection, in milliseconds. */
export const CONNECT_TIMEOUT_MS = 5000;

export type QuotingStyle = "double" | "backtick" | "bracket";

/** `"name"` — PostgreSQL, Oracle, SQLite, ANSI. */
export function quoteDouble(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/** `` `name` `` — MySQL, BigQuery. */
export function quoteBacktick(ident: string): string {
  return `\`${ident.replace(/`/g, "``")}\``;
}

/** `[name]` — SQL Server. */
export function quoteBracket(ident: string): string {
  return `[${ident.replace(/]/g, "]]")}]`;
}

/** The quoting an engine id (as stored on a connection) uses; same rules as `q()` of dbml-engine. */
export function quotingStyleFor(engine: string): QuotingStyle {
  if (engine === "mysql" || engine === "bigquery") return "backtick";
  if (engine === "mssql") return "bracket";
  return "double";
}

export function quoteIdentifier(ident: string, engine: string): string {
  const style = quotingStyleFor(engine);
  return style === "backtick" ? quoteBacktick(ident) : style === "bracket" ? quoteBracket(ident) : quoteDouble(ident);
}

/** Standard SQL string literal (PostgreSQL with `standard_conforming_strings`, SQL Server, Oracle, SQLite). */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
