import type { Table } from "@nebuladb/shared";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { ApiError } from "../../shared/errors.js";

/**
 * A script (or an AI agent) names a table the way its DBML does, so a table reference is the
 * table's id or, failing that, its name (case-insensitive; `schema.name` when the table has a
 * schema). A name two tables share is refused rather than guessed. `null` when nothing matches.
 */
export function findTable<T extends Pick<Table, "id" | "name" | "schemaName">>(tables: T[], ref: string): T | null {
  const byId = tables.find((candidate) => candidate.id === ref);
  if (byId) return byId;
  const wanted = ref.toLowerCase();
  const named = tables.filter(
    (candidate) =>
      candidate.name.toLowerCase() === wanted ||
      (candidate.schemaName !== undefined && `${candidate.schemaName}.${candidate.name}`.toLowerCase() === wanted),
  );
  if (named.length > 1) {
    throw new ApiError("TABLE_NOT_FOUND", { message: `several tables are named "${ref}" — use the table's id` });
  }
  return named[0] ?? null;
}

/** `findTable` against the project's current schema; refuses an unknown table. */
export async function requireTable(projectId: string, projectName: string, ref: string): Promise<Table> {
  const table = findTable((await readProjectReadOnly(projectId, projectName)).tables, ref);
  if (!table) throw new ApiError("TABLE_NOT_FOUND", { message: `no table "${ref}" in this project` });
  return table;
}
