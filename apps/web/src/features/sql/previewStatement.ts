import type { DatabaseEngine } from "@nebuladb/shared";

/** How many rows "Voir les données" asks for. The server caps results anyway; this keeps the statement honest about it. */
const PREVIEW_ROWS = 100;

const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Table names people actually use that are also keywords somewhere. Not a
 * complete list of reserved words — quoting is always safe, so the cost of a
 * word missing here is a query that says so, and of one too many, two quotes.
 */
const RESERVED = new Set(
  "all and as between by case check column constraint default desc end from group having in index into is join key like limit not null of on or order primary references select set table to union unique user using values view when where with".split(
    " ",
  ),
);

/**
 * Quoted only when it has to be: `users` stays `users`, which is what someone
 * would type and what they will want to edit; `Order Items` cannot. A plain
 * lower-case name is the one spelling every engine reads the same way —
 * anything with capitals is quoted, since PostgreSQL and Oracle would
 * otherwise fold it to another case and miss the table.
 */
export function quoteIdentifier(name: string, engine: DatabaseEngine): string {
  if (PLAIN_IDENTIFIER.test(name) && !RESERVED.has(name)) return name;
  if (engine === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  if (engine === "mssql") return `[${name.replace(/]/g, "]]")}]`;
  return `"${name.replace(/"/g, '""')}"`;
}

/** The first rows of a table, in the engine's own dialect. */
export function previewRowsStatement(
  engine: DatabaseEngine,
  table: { name: string; schemaName?: string },
  rows = PREVIEW_ROWS,
): string {
  const target = [table.schemaName, table.name]
    .filter((part): part is string => Boolean(part))
    .map((part) => quoteIdentifier(part, engine))
    .join(".");
  if (engine === "mssql") return `SELECT TOP ${rows} * FROM ${target}`;
  if (engine === "oracle") return `SELECT * FROM ${target} FETCH FIRST ${rows} ROWS ONLY`;
  return `SELECT * FROM ${target} LIMIT ${rows}`;
}
