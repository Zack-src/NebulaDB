import type { DatabaseEngine } from "@athanordb/shared";

export const VALID_ENGINES: ReadonlySet<string> = new Set<DatabaseEngine>([
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "oracle",
]);

export function isValidEngine(engine: unknown): engine is DatabaseEngine {
  return typeof engine === "string" && VALID_ENGINES.has(engine);
}
