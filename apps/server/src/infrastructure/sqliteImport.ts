import Database from "better-sqlite3";
import { db } from "./db.js";
import { SQLITE_FINAL_VERSION } from "./migrations.js";

/**
 * Copies an instance's SQLite storage into the PostgreSQL database `db` is
 * connected to — once, when an existing installation moves over. Everything
 * or nothing: one transaction, checked row counts, and a refusal (before any
 * write) when the file is not at the last SQLite schema or the target already
 * holds data.
 */

/** The three stages a fresh database is seeded with: an empty target may hold these and nothing else. */
const SEEDED_ENVIRONMENTS = ["DEV", "Prod", "Staging"];

/** Rows per INSERT: well under PostgreSQL's 65535 parameters for the widest table. */
const BATCH_ROWS = 200;

interface ColumnInfo {
  name: string;
}

interface ForeignKey {
  table: string;
  column: string;
  references: string;
}

export interface TableCopy {
  table: string;
  rows: number;
}

export class SqliteImportRefused extends Error {}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function targetTables(): Promise<string[]> {
  const rows = (await db
    .prepare(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'`,
    )
    .all()) as { table_name: string }[];
  return rows.map((row) => row.table_name);
}

async function targetColumns(table: string): Promise<string[]> {
  const rows = (await db
    .prepare(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`,
    )
    .all(table)) as { column_name: string }[];
  return rows.map((row) => row.column_name);
}

async function foreignKeys(): Promise<ForeignKey[]> {
  return (await db
    .prepare(
      `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column", c.confrelid::regclass::text AS "references"
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`,
    )
    .all()) as ForeignKey[];
}

/** Referenced tables before the tables referring to them. A table referring to itself is handled row by row. */
function copyOrder(tables: string[], keys: ForeignKey[]): string[] {
  const ordered: string[] = [];
  const placed = new Set<string>();
  const visit = (table: string, path: Set<string>) => {
    if (placed.has(table)) return;
    if (path.has(table)) throw new Error(`foreign keys form a cycle through ${table}`);
    path.add(table);
    for (const key of keys) if (key.table === table && key.references !== table) visit(key.references, path);
    path.delete(table);
    placed.add(table);
    ordered.push(table);
  };
  for (const table of [...tables].sort()) visit(table, new Set());
  return ordered;
}

/** Refuses a target that already holds anything but the stages every new database starts with. */
async function assertTargetEmpty(tables: string[]): Promise<void> {
  const occupied: string[] = [];
  for (const table of tables) {
    if (table === "environments") continue;
    if (await db.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get()) occupied.push(table);
  }
  const stages = ((await db.prepare("SELECT name FROM environments ORDER BY name").all()) as { name: string }[]).map(
    (row) => row.name,
  );
  const untouched =
    stages.length === 0 ||
    (stages.length === SEEDED_ENVIRONMENTS.length && stages.every((name, i) => name === SEEDED_ENVIRONMENTS[i]));
  if (!untouched) occupied.push("environments");
  if (occupied.length > 0) {
    throw new SqliteImportRefused(
      `the PostgreSQL database is not empty (${occupied.join(", ")}): this tool only fills a new one`,
    );
  }
}

/**
 * Copies `sqlitePath` into the current PostgreSQL database. Resolves with the
 * row counts copied, table by table; throws `SqliteImportRefused` (nothing
 * written) or the database's own error (everything rolled back).
 */
export async function importSqliteFile(
  sqlitePath: string,
  log: (line: string) => void = () => {},
): Promise<TableCopy[]> {
  let source: Database.Database;
  try {
    source = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new SqliteImportRefused(`cannot open ${sqlitePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const version = source.pragma("user_version", { simple: true }) as number;
    if (version !== SQLITE_FINAL_VERSION) {
      throw new SqliteImportRefused(
        `${sqlitePath} is at schema version ${version}, not ${SQLITE_FINAL_VERSION}: start the last SQLite release ` +
          "of NebulaDB on it once, so it brings the file up to date, then run this again",
      );
    }
    const sourceTables = (
      source
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);

    return await db.transaction(async () => {
      const tables = await targetTables();
      // Nothing may be lost on the way: a table or a column with nowhere to go stops everything.
      const unknown = sourceTables.filter((table) => !tables.includes(table));
      if (unknown.length > 0) throw new SqliteImportRefused(`no PostgreSQL table for: ${unknown.join(", ")}`);
      await assertTargetEmpty(tables);
      // Seeded by the first migration; the instance's own stages replace them.
      await db.prepare("DELETE FROM environments").run();

      const keys = await foreignKeys();
      const copied: TableCopy[] = [];
      for (const table of copyOrder(tables, keys)) {
        if (!sourceTables.includes(table)) continue;
        const rows = await copyTable(source, table, keys);
        copied.push({ table, rows });
        log(`${table}: ${rows} row(s)`);
      }
      return copied;
    });
  } finally {
    source.close();
  }
}

async function copyTable(source: Database.Database, table: string, keys: ForeignKey[]): Promise<number> {
  const targetCols = await targetColumns(table);
  const sourceCols = (source.prepare(`PRAGMA table_info(${quote(table)})`).all() as ColumnInfo[]).map((c) => c.name);
  const missing = sourceCols.filter((column) => !targetCols.includes(column));
  if (missing.length > 0) {
    throw new SqliteImportRefused(`no PostgreSQL column for ${table}.${missing.join(`, ${table}.`)}`);
  }
  // The insertion order SQLite kept as `rowid` is what `seq` stands for here.
  const withSeq = targetCols.includes("seq") && !sourceCols.includes("seq");
  // A reference to another row of the same table is filled in once every row is there.
  const selfRefs = keys
    .filter((key) => key.table === table && key.references === table)
    .map((key) => key.column)
    .filter((column) => sourceCols.includes(column));
  const columns = [...sourceCols, ...(withSeq ? ["seq"] : [])];
  const select = `SELECT ${sourceCols.map(quote).join(", ")}${withSeq ? ", rowid AS seq" : ""} FROM ${quote(table)} ORDER BY rowid`;

  let count = 0;
  let batch: unknown[][] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const values = batch.map((row) => `(${row.map(() => "?").join(", ")})`).join(", ");
    await db
      .prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES ${values}`)
      .run(...batch.flat());
    count += batch.length;
    batch = [];
  };
  for (const row of source.prepare(select).iterate() as IterableIterator<Record<string, unknown>>) {
    batch.push(columns.map((column) => (selfRefs.includes(column) ? null : row[column])));
    if (batch.length === BATCH_ROWS) await flush();
  }
  await flush();

  for (const column of selfRefs) {
    const links = source
      .prepare(`SELECT id, ${quote(column)} AS ref FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`)
      .all() as { id: string; ref: string }[];
    const update = db.prepare(`UPDATE ${quote(table)} SET ${quote(column)} = ? WHERE id = ?`);
    for (const link of links) await update.run(link.ref, link.id);
  }
  if (withSeq && count > 0) {
    // The next row gets the number after the last copied one.
    await db.prepare(`SELECT setval(pg_get_serial_sequence(?, 'seq'), MAX(seq)) FROM ${quote(table)}`).get(table);
  }

  const expected = (source.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: number }).n;
  const landed = ((await db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get()) as { n: number }).n;
  if (count !== expected || landed !== expected) {
    throw new Error(`${table}: ${expected} row(s) in SQLite, ${landed} in PostgreSQL`);
  }
  return count;
}
