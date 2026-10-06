import {
  SEED_MAX_BYTES,
  SEED_MAX_ROWS,
  SEED_MODES,
  SEED_SEPARATORS,
  parseCsv,
  type SeedMode,
  type SeedOptions,
  type SeedSeparator,
  type TableSeed,
  type TableSeedSummary,
} from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

interface SeedRow {
  project_id: string;
  table_id: string;
  table_name: string;
  content: string;
  options_json: string;
  row_count: number;
  bytes: number;
  updated_by_name: string | null;
  updated_at: string;
}

function rowToSummary(row: SeedRow): TableSeedSummary {
  return {
    tableId: row.table_id,
    tableName: row.table_name,
    format: "csv",
    rowCount: row.row_count,
    bytes: row.bytes,
    options: JSON.parse(row.options_json) as SeedOptions,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
  };
}

export function listSeeds(projectId: string): TableSeedSummary[] {
  return (
    db
      .prepare(
        "SELECT project_id, table_id, table_name, options_json, row_count, bytes, updated_by_name, updated_at, '' AS content FROM table_seeds WHERE project_id = ? ORDER BY table_name COLLATE NOCASE",
      )
      .all(projectId) as SeedRow[]
  ).map(rowToSummary);
}

export function getSeed(projectId: string, tableId: string): TableSeed | null {
  const row = db.prepare("SELECT * FROM table_seeds WHERE project_id = ? AND table_id = ?").get(projectId, tableId) as
    SeedRow | undefined;
  return row ? { ...rowToSummary(row), content: row.content } : null;
}

/** Every seed of a project with its file — what a deployment inserts. */
export function listSeedsWithContent(projectId: string): TableSeed[] {
  return (db.prepare("SELECT * FROM table_seeds WHERE project_id = ?").all(projectId) as SeedRow[]).map((row) => ({
    ...rowToSummary(row),
    content: row.content,
  }));
}

/**
 * Checks what a client sent for a seed. The file must parse and stay under
 * the size and row caps; the options must name a known separator and mode,
 * and the mapping hold one entry (a field id or `null`) per CSV column.
 * Whether the rows fit the table is `validateSeed`'s question, asked again at
 * every deployment — a seed may be saved with issues and fixed later.
 */
export function parseSeedInput(body: unknown): { content: string; options: SeedOptions; rowCount: number } {
  const raw = (body ?? {}) as { content?: unknown; options?: Record<string, unknown> };
  if (typeof raw.content !== "string" || raw.content.length === 0) throw new ApiError("SEED_INVALID");
  const bytes = Buffer.byteLength(raw.content, "utf8");
  if (bytes > SEED_MAX_BYTES)
    throw new ApiError("SEED_INVALID", { message: `seed is ${bytes} bytes, the limit is ${SEED_MAX_BYTES}` });
  const options = raw.options ?? {};
  if (!SEED_SEPARATORS.includes(options.separator as SeedSeparator)) throw new ApiError("SEED_INVALID");
  if (typeof options.header !== "boolean") throw new ApiError("SEED_INVALID");
  if (!SEED_MODES.includes(options.mode as SeedMode)) throw new ApiError("SEED_INVALID");
  const mapping = options.mapping;
  if (!Array.isArray(mapping) || !mapping.every((m) => m === null || (typeof m === "string" && m.length <= 200))) {
    throw new ApiError("SEED_INVALID");
  }
  const parsed = parseCsv(raw.content, options.separator as SeedSeparator);
  const rowCount = Math.max(0, parsed.length - (options.header ? 1 : 0));
  if (rowCount > SEED_MAX_ROWS) {
    throw new ApiError("SEED_INVALID", { message: `seed has ${rowCount} rows, the limit is ${SEED_MAX_ROWS}` });
  }
  const width = parsed[0]?.length ?? 0;
  if (mapping.length !== width)
    throw new ApiError("SEED_INVALID", { message: "the mapping needs one entry per CSV column" });
  return {
    content: raw.content,
    options: {
      separator: options.separator as SeedSeparator,
      header: options.header,
      mapping: mapping as (string | null)[],
      mode: options.mode as SeedMode,
    },
    rowCount,
  };
}

export function upsertSeed(input: {
  projectId: string;
  tableId: string;
  tableName: string;
  content: string;
  options: SeedOptions;
  rowCount: number;
  updatedBy: string;
  updatedByName: string;
}): TableSeed {
  db.prepare(
    `INSERT INTO table_seeds (project_id, table_id, table_name, content, options_json, row_count, bytes, updated_by, updated_by_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, table_id) DO UPDATE SET
       table_name = excluded.table_name, content = excluded.content, options_json = excluded.options_json,
       row_count = excluded.row_count, bytes = excluded.bytes, updated_by = excluded.updated_by,
       updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`,
  ).run(
    input.projectId,
    input.tableId,
    input.tableName,
    input.content,
    JSON.stringify(input.options),
    input.rowCount,
    Buffer.byteLength(input.content, "utf8"),
    input.updatedBy,
    input.updatedByName,
  );
  return getSeed(input.projectId, input.tableId)!;
}

export function deleteSeed(projectId: string, tableId: string): boolean {
  return (
    db.prepare("DELETE FROM table_seeds WHERE project_id = ? AND table_id = ?").run(projectId, tableId).changes > 0
  );
}
