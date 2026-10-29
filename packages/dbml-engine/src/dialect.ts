/**
 * The SQL (and non-SQL) dialects a schema is deployed to, and how each quotes a name. Kept apart from the migration
 * generator, which the modules that need only these (`renameDetection`, `sqlFragments`) would otherwise import in a
 * circle.
 */
export type MigrationDialect =
  "postgres" | "mysql" | "sqlite" | "mssql" | "oracle" | "bigquery" | "clickhouse" | "mongodb" | "redis";

export function q(ident: string, dialect: MigrationDialect): string {
  if (dialect === "mysql" || dialect === "bigquery" || dialect === "clickhouse") {
    return `\`${ident.replace(/`/g, "``")}\``;
  }
  if (dialect === "mssql") return `[${ident.replace(/]/g, "]]")}]`;
  return `"${ident.replace(/"/g, '""')}"`;
}
