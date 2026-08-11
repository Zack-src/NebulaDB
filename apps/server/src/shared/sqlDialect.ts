import type { SqlDialect } from "@athanordb/dbml-engine";

export const SQL_DIALECTS: SqlDialect[] = ["postgres", "mysql", "mssql"];

export function isSqlDialect(value: unknown): value is SqlDialect {
  return typeof value === "string" && (SQL_DIALECTS as string[]).includes(value);
}
