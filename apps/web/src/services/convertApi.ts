import { request } from "./httpClient";

export type SqlDialect = "postgres" | "mysql" | "mssql";

/**
 * SQL DDL -> DBML, server-side. The parser lives in `@dbml/core`, which is far
 * too large to ship to the browser just so a built-in importer can match the
 * plugin contract (DBML is the single import currency).
 */
export function convertSqlToDbml(source: string, dialect: SqlDialect): Promise<{ dbml: string }> {
  return request<{ dbml: string }>("/api/convert/to-dbml", { method: "POST", body: { source, dialect } });
}
