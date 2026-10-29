import type { Project } from "@nebuladb/shared";
import { dropForeignKeyStatement, generateDropTable, type MigrationDialect } from "./migrationGenerator.js";

export interface CleanDeploymentPlan {
  /** The script: foreign keys and tables out, in one transaction where the engine has one. Nothing is written back. */
  sql: string;
  /** The tables of the database the script drops, with what they hold. */
  dropTables: string[];
}

/**
 * A wipe: every table of the database in `scope` is dropped, with its columns and its data, and nothing is created
 * again. No diff to settle, so none of its conflicts can stand in the way. The data is gone: the caller asks for
 * a backup, a confirmation, and never offers this on a production stage.
 *
 * `scope`: lower-case names of the live tables to drop. The caller decides — the tables of the schema and those
 * Nebula once deployed, or every table when someone asked for it.
 */
export function planCleanDeployment(
  live: Project,
  dialect: MigrationDialect,
  scope: ReadonlySet<string>,
): CleanDeploymentPlan {
  const inScope = live.tables.filter((table) => scope.has(table.name.toLowerCase()));
  const dropped = new Set(inScope.map((table) => table.name.toLowerCase()));
  const tableById = new Map(live.tables.map((table) => [table.id, table]));
  const statements: string[] = [];

  // Every foreign key that touches a table going away, whichever side the table is on: an engine refuses to drop
  // a table another one still points at, and some refuse to drop one that points elsewhere first.
  for (const ref of live.refs) {
    const from = tableById.get(ref.from.tableId);
    const to = tableById.get(ref.to.tableId);
    if (!from || !to) continue;
    if (!dropped.has(from.name.toLowerCase()) && !dropped.has(to.name.toLowerCase())) continue;
    const statement = dropForeignKeyStatement(
      {
        ...(ref.name ? { name: ref.name } : {}),
        fromTable: from.name,
        fromField: from.fields.find((field) => field.id === ref.from.fieldId)?.name ?? ref.from.fieldId,
        toTable: to.name,
        toField: to.fields.find((field) => field.id === ref.to.fieldId)?.name ?? ref.to.fieldId,
        status: "dropped",
      },
      dialect,
    );
    if (statement) statements.push(statement);
  }
  for (const table of inScope) statements.push(generateDropTable(table.name, dialect));

  const opens =
    dialect === "postgres"
      ? "BEGIN;"
      : dialect === "mysql"
        ? "START TRANSACTION;"
        : dialect === "sqlite" || dialect === "mssql"
          ? "BEGIN TRANSACTION;"
          : null;
  // BigQuery and ClickHouse run no DDL in a transaction; MongoDB's commands are not SQL at all.
  const closes = ["bigquery", "clickhouse", "mongodb", "redis"].includes(dialect) ? null : "COMMIT;";
  const sql = [...(opens ? [opens] : []), ...statements, ...(closes ? [closes] : [])].join("\n\n");
  return { sql, dropTables: inScope.map((table) => table.name) };
}
