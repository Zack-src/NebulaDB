import type { Completion } from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";
import type { DatabaseEngine, DbAdminColumn, DbAdminTable, Table } from "@nebuladb/shared";
import { quoteIdentifier } from "./previewStatement";

export interface SqlCatalogColumn {
  name: string;
  type: string;
  primaryKey: boolean;
}

/** One table the SQL editor can complete. `columns` is `null` until something has said what they are. */
export interface SqlCatalogTable {
  schema: string | null;
  name: string;
  kind: "table" | "view";
  columns: SqlCatalogColumn[] | null;
}

export function catalogKey(table: { schema: string | null; name: string }): string {
  return `${table.schema ?? ""}\u0000${table.name}`;
}

/**
 * What the editor completes from: the database's own tables first, since they
 * are what the statement will run against, with the columns the database has
 * described so far. The project's schema fills what is not known yet — the
 * columns of a table not described, and the tables themselves while the
 * database has not answered (or cannot be reached).
 */
export function mergeCatalog(
  databaseTables: readonly DbAdminTable[] | null,
  described: ReadonlyMap<string, readonly DbAdminColumn[]>,
  projectTables: readonly Table[],
): SqlCatalogTable[] {
  const modelled = new Map<string, Table>();
  for (const table of projectTables) modelled.set(table.name.toLowerCase(), table);
  const fromProject = (table: Table): SqlCatalogColumn[] =>
    table.fields.map((field) => ({ name: field.name, type: field.type, primaryKey: Boolean(field.pk) }));

  const catalog: SqlCatalogTable[] = [];
  const seen = new Set<string>();
  for (const table of databaseTables ?? []) {
    const columns = described.get(catalogKey(table));
    const model = modelled.get(table.name.toLowerCase());
    seen.add(table.name.toLowerCase());
    catalog.push({
      schema: table.schema,
      name: table.name,
      kind: table.kind,
      columns: columns
        ? columns.map((column) => ({ name: column.name, type: column.type, primaryKey: column.primaryKey }))
        : model
          ? fromProject(model)
          : null,
    });
  }
  for (const table of projectTables) {
    if (seen.has(table.name.toLowerCase())) continue;
    catalog.push({ schema: table.schemaName ?? null, name: table.name, kind: "table", columns: fromProject(table) });
  }
  return catalog;
}

const PLAIN_WORD = /^[\p{L}_][\p{L}\p{N}_$]*$/u;
const WORDS = /[\p{L}_][\p{L}\p{N}_$]*/gu;

/** The catalog's tables a statement names — the ones whose columns are worth knowing. */
export function referencedTables(statement: string, catalog: readonly SqlCatalogTable[]): SqlCatalogTable[] {
  if (catalog.length === 0 || !statement.trim()) return [];
  const lower = statement.toLowerCase();
  const words = new Set(lower.match(WORDS));
  return catalog.filter((table) => {
    const name = table.name.toLowerCase();
    // A name with a space or a dash is only ever written quoted: look for it as it stands.
    return PLAIN_WORD.test(name) ? words.has(name) : lower.includes(name);
  });
}

/** `lang-sql` reads a dot in a name as a path separator unless it is escaped. */
const escapeName = (name: string) => name.replace(/\./g, "\\.");

/** Where an unqualified table name is looked up, on the engines that have such a thing. */
const DEFAULT_SCHEMA: Partial<Record<DatabaseEngine, string>> = { postgres: "public", mssql: "dbo" };

export interface SqlCompletionLabels {
  table: string;
  view: string;
}

/** A name that cannot be written bare is inserted quoted, the engine's way. */
function named(name: string, engine: DatabaseEngine, rest: Omit<Completion, "label">): Completion {
  const quoted = quoteIdentifier(name, engine);
  return quoted === name ? { label: name, ...rest } : { label: name, apply: quoted, ...rest };
}

/**
 * The columns of the tables a statement names, to offer where no table is
 * spelled out (`WHERE na…`): `lang-sql` itself only completes a column after
 * `table.`. A name several of those tables share is offered once, with the
 * tables it belongs to.
 */
export function columnCompletions(
  statement: string,
  catalog: readonly SqlCatalogTable[],
  engine: DatabaseEngine,
): Completion[] {
  const columns = new Map<string, { column: SqlCatalogColumn; tables: string[] }>();
  for (const table of referencedTables(statement, catalog)) {
    for (const column of table.columns ?? []) {
      const known = columns.get(column.name);
      if (known) known.tables.push(table.name);
      else columns.set(column.name, { column, tables: [table.name] });
    }
  }
  return [...columns.values()].map(({ column, tables }) =>
    named(column.name, engine, {
      type: column.primaryKey ? "constant" : "property",
      detail: `${column.type} · ${tables.join(", ")}`,
      boost: 20,
    }),
  );
}

/** The catalog in the shape `@codemirror/lang-sql` completes from. */
export function toSqlSchema(
  catalog: readonly SqlCatalogTable[],
  engine: DatabaseEngine,
  labels: SqlCompletionLabels,
): { schema: SQLNamespace; defaultSchema?: string } {
  const top: Record<string, SQLNamespace> = {};
  const schemas = new Set<string>();
  for (const table of catalog) {
    const node: SQLNamespace = {
      self: named(table.name, engine, { type: "class", detail: labels[table.kind], boost: 40 }),
      children: (table.columns ?? []).map((column) =>
        named(column.name, engine, {
          type: column.primaryKey ? "constant" : "property",
          detail: column.type + (column.primaryKey ? " · pk" : ""),
          boost: column.primaryKey ? 30 : 10,
        }),
      ),
    };
    if (table.schema) {
      schemas.add(table.schema);
      const scope = (top[escapeName(table.schema)] ??= {}) as Record<string, SQLNamespace>;
      scope[escapeName(table.name)] = node;
    } else {
      top[escapeName(table.name)] = node;
    }
  }
  const preferred = DEFAULT_SCHEMA[engine];
  const defaultSchema =
    preferred && schemas.has(preferred) ? preferred : schemas.size === 1 ? [...schemas][0] : undefined;
  return { schema: top, defaultSchema };
}
