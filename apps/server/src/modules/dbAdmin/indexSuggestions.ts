import { defaultIndexName, generateCreateIndex, type MigrationDialect } from "@nebuladb/dbml-engine";
import type { DbIndexSuggestion, DbIndexSuggestionStatement, DbQueryStat } from "@nebuladb/shared";
import type { DatabaseAdminDriver } from "./drivers/index.js";
import { readStatement, type ColumnUse, type StatementBlock, type TableRef } from "./sqlReader.js";

/**
 * Index suggestions from the statements the SQL console ran: the columns they filter, join and
 * sort on (`sqlReader.ts`), compared with the indexes the database has. Lives on the server rather
 * than in `dbml-engine` because it reads `DbQueryStat` rows and a live catalog, neither of which
 * the engine knows; the CREATE INDEX text comes from the engine's migration generator.
 *
 * What is claimed is only what was measured: the motivating statements with their runs and time,
 * and the share of the connection's measured time they account for. No gain is predicted.
 */

export const MAX_SUGGESTIONS = 10;
const MAX_STATEMENTS_PER_SUGGESTION = 5;
const MAX_COLUMNS = 4;
const MAX_NAME_LENGTH = 60;

/** A table of the live database, as the suggestions need it. */
export interface CatalogTable {
  schema: string | null;
  name: string;
  columns: string[];
  /** The indexes it has, the primary key and unique ones included. */
  indexes: { columns: string[]; unique: boolean }[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Where an unqualified table name is looked for first, per engine's habit. */
const DEFAULT_SCHEMAS = ["public", "dbo", "main"];

/** The live table a statement's table reference means, or `null` when it is unknown or ambiguous. */
export function resolveTable(ref: TableRef, catalog: CatalogTable[]): CatalogTable | null {
  const named = catalog.filter((t) => same(t.name, ref.name));
  const inSchema = ref.schema ? named.filter((t) => !t.schema || same(t.schema, ref.schema!)) : named;
  if (inSchema.length === 1) return inSchema[0];
  if (inSchema.length === 0 || ref.schema) return null;
  const preferred = inSchema.filter((t) => t.schema && DEFAULT_SCHEMAS.includes(t.schema.toLowerCase()));
  return preferred.length === 1 ? preferred[0] : null;
}

/** The table a column use belongs to within its block, or `null` when that cannot be told. */
function ownerOf(
  use: ColumnUse,
  block: StatementBlock,
  owners: Map<TableRef, CatalogTable | null>,
): CatalogTable | null {
  if (use.qualifier) {
    const ref = block.tables.find((t) => (t.alias ? same(t.alias, use.qualifier!) : same(t.name, use.qualifier!)));
    return ref ? (owners.get(ref) ?? null) : null;
  }
  // Unqualified: the one table that has the column, provided every table of the statement is known.
  if (block.hasDerivedSource || !block.tables.every((ref) => owners.get(ref))) return null;
  const holders = new Set(
    block.tables.map((ref) => owners.get(ref)!).filter((t) => t.columns.some((c) => same(c, use.column))),
  );
  return holders.size === 1 ? [...holders][0] : null;
}

function addUnique(list: string[], column: string): void {
  if (!list.some((c) => same(c, column))) list.push(column);
}

/**
 * The columns an index would need for one block's use of one table: equality (and join) columns,
 * then one range column, or the sort when there is no range (a sort needs a filter or a limit to
 * be worth an index of its own). `eq` is how many leading columns are interchangeable.
 */
function candidateOf(uses: ColumnUse[], limited: boolean): { columns: string[]; eq: number } | null {
  const eq: string[] = [];
  const range: string[] = [];
  const sort: string[] = [];
  for (const use of uses) addUnique(use.kind === "range" ? range : use.kind === "sort" ? sort : eq, use.column);
  const columns = [...eq];
  if (range.length > 0) {
    if (!eq.some((c) => same(c, range[0]))) columns.push(range[0]);
  } else if (eq.length > 0 || limited) {
    for (const column of sort) addUnique(columns, column);
  }
  if (columns.length === 0) return null;
  return { columns: columns.slice(0, MAX_COLUMNS), eq: Math.min(eq.length, MAX_COLUMNS) };
}

/** An index whose leading columns are these ones (the first `eq` in any order, the rest in order). */
function covers(index: string[], columns: string[], eq: number): boolean {
  if (index.length < columns.length) return false;
  const head = index.slice(0, eq).map((c) => c.toLowerCase());
  const wanted = columns.slice(0, eq).map((c) => c.toLowerCase());
  return wanted.every((c) => head.includes(c)) && columns.slice(eq).every((c, i) => same(c, index[eq + i]));
}

interface Candidate {
  table: CatalogTable;
  columns: string[];
  eq: number;
  statements: Map<string, DbQueryStat>;
}

const keyOf = (table: CatalogTable, columns: string[]) =>
  `${table.schema ?? ""}.${table.name}(${columns.join(",")})`.toLowerCase();

/** The table references of a statement set, for the caller to describe before `suggestIndexes`. */
export function referencedTables(stats: DbQueryStat[], engine: string | undefined): TableRef[] {
  const seen = new Map<string, TableRef>();
  for (const stat of stats) {
    for (const block of readStatement(stat.sql, engine)) {
      for (const ref of block.tables) seen.set(`${ref.schema ?? ""}.${ref.name}`.toLowerCase(), ref);
    }
  }
  return [...seen.values()];
}

/**
 * The indexes the statements would use and the catalog lacks, the most time-consuming first, at
 * most `MAX_SUGGESTIONS`. A statement that failed every time, or that cannot be read, motivates
 * nothing; a table missing from the catalog (another database, a view) gets nothing.
 */
export function suggestIndexes(
  stats: DbQueryStat[],
  catalog: CatalogTable[],
  engine: MigrationDialect,
): DbIndexSuggestion[] {
  // BigQuery has no secondary index to suggest.
  if (engine === "bigquery") return [];
  const candidates = new Map<string, Candidate>();
  for (const stat of stats) {
    if (stat.executions <= stat.failures) continue;
    for (const block of readStatement(stat.sql, engine)) {
      const owners = new Map<TableRef, CatalogTable | null>(
        block.tables.map((ref) => [ref, resolveTable(ref, catalog)]),
      );
      const byTable = new Map<CatalogTable, ColumnUse[]>();
      let sortOwner: CatalogTable | null | undefined;
      for (const use of block.uses) {
        const table = ownerOf(use, block, owners);
        if (!table || !table.columns.some((c) => same(c, use.column))) continue;
        if (use.kind === "sort") {
          // The sort is served by one index only when it all falls on one table.
          if (sortOwner === undefined) sortOwner = table;
          if (sortOwner !== table) continue;
        }
        byTable.set(table, [...(byTable.get(table) ?? []), use]);
      }
      for (const [table, uses] of byTable) {
        const candidate = candidateOf(uses, block.limited);
        if (!candidate) continue;
        // Spelled as the database spells them.
        const columns = candidate.columns.map((c) => table.columns.find((own) => same(own, c)) ?? c);
        if (table.indexes.some((index) => covers(index.columns, columns, candidate.eq))) continue;
        // An equality on every column of a unique index finds one row: the rest changes nothing.
        const eqColumns = columns.slice(0, candidate.eq);
        const unique = table.indexes.some(
          (index) => index.unique && index.columns.every((c) => eqColumns.some((e) => same(e, c))),
        );
        if (unique) continue;
        const key = keyOf(table, columns);
        const known = candidates.get(key);
        if (known) known.statements.set(stat.hash, stat);
        else candidates.set(key, { table, columns, eq: candidate.eq, statements: new Map([[stat.hash, stat]]) });
      }
    }
  }

  // An index that is the beginning of another suggested one is served by it: they motivate together.
  const all = [...candidates.values()];
  const kept = all.filter((candidate) => {
    const longer = all.find(
      (other) =>
        other !== candidate &&
        other.table === candidate.table &&
        other.columns.length > candidate.columns.length &&
        covers(other.columns, candidate.columns, candidate.eq),
    );
    if (longer) for (const [hash, stat] of candidate.statements) longer.statements.set(hash, stat);
    return !longer;
  });

  const measured = new Map(stats.map((stat) => [stat.hash, stat.totalMs]));
  const measuredTotal = [...measured.values()].reduce((sum, ms) => sum + ms, 0);
  return kept
    .map((candidate): DbIndexSuggestion => {
      const statements = [...candidate.statements.values()].sort(
        (a, b) => b.totalMs - a.totalMs || b.executions - a.executions || a.hash.localeCompare(b.hash),
      );
      const totalMs = statements.reduce((sum, s) => sum + s.totalMs, 0);
      const name = defaultIndexName(candidate.table.name, candidate.columns).slice(0, MAX_NAME_LENGTH);
      return {
        schema: candidate.table.schema,
        table: candidate.table.name,
        columns: candidate.columns,
        statements: statements.slice(0, MAX_STATEMENTS_PER_SUGGESTION).map(toStatement),
        statementCount: statements.length,
        executions: statements.reduce((sum, s) => sum + s.executions, 0),
        totalMs,
        shareOfMeasuredMs: measuredTotal > 0 ? Math.round((totalMs / measuredTotal) * 100) : 0,
        createStatement: generateCreateIndex(candidate.table.name, candidate.columns, name, engine, {
          schema: candidate.table.schema,
        }),
      };
    })
    .sort(
      (a, b) =>
        b.totalMs - a.totalMs ||
        b.executions - a.executions ||
        `${a.table}.${a.columns}`.localeCompare(`${b.table}.${b.columns}`),
    )
    .slice(0, MAX_SUGGESTIONS);
}

function toStatement(stat: DbQueryStat): DbIndexSuggestionStatement {
  return {
    hash: stat.hash,
    sql: stat.sql,
    executions: stat.executions,
    avgMs: stat.avgMs,
    maxMs: stat.maxMs,
    totalMs: stat.totalMs,
  };
}

const MAX_TABLES_DESCRIBED = 40;

/**
 * The live tables the statements refer to, with their columns and indexes, read through the
 * administration driver (views and unknown names are left out). A table it cannot describe is
 * left out too, so it gets no suggestion.
 */
export async function readCatalog(
  driver: DatabaseAdminDriver,
  refs: TableRef[],
  database: string | undefined,
): Promise<CatalogTable[]> {
  const tables = (await driver.listTables(database)).filter((t) => t.kind === "table");
  const wanted = tables.filter((t) => refs.some((ref) => same(ref.name, t.name))).slice(0, MAX_TABLES_DESCRIBED);
  const catalog: CatalogTable[] = [];
  for (const table of wanted) {
    try {
      const description = await driver.describeTable({
        database,
        schema: table.schema ?? undefined,
        table: table.name,
      });
      const indexes = description.indexes.map((index) => ({
        columns: index.columns,
        unique: index.unique || index.primary,
      }));
      // A key the engine does not list as an index (SQLite's rowid alias) is one all the same.
      const key = description.columns.filter((c) => c.primaryKey).map((c) => c.name);
      if (key.length > 0 && !description.indexes.some((index) => index.primary)) {
        indexes.push({ columns: key, unique: true });
      }
      catalog.push({
        schema: table.schema,
        name: table.name,
        columns: description.columns.map((c) => c.name),
        indexes,
      });
    } catch {
      // Not describable with this account: no suggestion on it.
    }
  }
  return catalog;
}
