/**
 * The database engines NebulaDB connects to. Kept in a file of its own, imported by the schema and by the
 * deployment stages alike, so that neither depends on the other.
 */
export type DatabaseEngine =
  "postgres" | "mysql" | "sqlite" | "mssql" | "oracle" | "bigquery" | "clickhouse" | "mongodb" | "redis";
