import type { Project } from "@nebuladb/shared";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import {
  dropForeignKeyStatement,
  generateDropTable,
  generateMigrationSql,
  type MigrationDialect,
} from "./migrationGenerator.js";

export interface CleanDeploymentPlan {
  /** The script: foreign keys and tables out, then the whole schema back in, in one transaction where the engine has one. */
  sql: string;
  /** The tables of the database the script drops, with what they hold. */
  dropTables: string[];
  /** The tables of the schema the script creates. */
  createTables: string[];
}

const TRANSACTION_LINES = /^(BEGIN( TRANSACTION)?|START TRANSACTION|COMMIT);$/;

/**
 * A deployment that starts over: every table of the database in `scope` is dropped, then the schema is created
 * as if the database were empty. No diff to settle, so none of its conflicts — a column inside a key, a rename
 * read as a drop, a foreign key over orphan rows — can stand in the way. The data is gone: the caller asks for
 * a backup, a confirmation, and never offers this on a production stage.
 *
 * `scope`: lower-case names of the live tables to drop. The caller decides — the tables of the schema and those
 * Nebula once deployed, or every table when someone asked for it.
 */
export function planCleanDeployment(
  live: Project,
  target: Project,
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

  // The schema, as a deployment to an empty database would write it.
  const empty: Project = { ...live, tables: [], refs: [] };
  const create = generateMigrationSql(diffTargetAgainstLive(empty, target), dialect);
  const body = create
    .split("\n\n")
    .filter((statement) => statement.trim().length > 0 && !TRANSACTION_LINES.test(statement.trim()));
  statements.push(...body);

  const opens = dialect === "postgres" ? "BEGIN;" : dialect === "mysql" ? "START TRANSACTION;" : dialect === "sqlite" || dialect === "mssql" ? "BEGIN TRANSACTION;" : null;
  const closes = dialect === "bigquery" ? null : "COMMIT;";
  const sql = [...(opens ? [opens] : []), ...statements, ...(closes ? [closes] : [])].join("\n\n");
  return { sql, dropTables: inScope.map((table) => table.name), createTables: target.tables.map((table) => table.name) };
}
