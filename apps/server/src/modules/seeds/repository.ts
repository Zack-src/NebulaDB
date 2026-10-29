import {
  SEED_MAX_BYTES,
  SEED_MAX_ROWS,
  SEED_MODES,
  SEED_SEPARATORS,
  parseCsv,
  type SeedMode,
  type SeedOverflow,
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
  storage: string;
  file_name: string | null;
  check_json: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

/** What the upload of a file seed found, kept with it. */
export interface SeedFileCheck {
  overflows: SeedOverflow[];
  unchecked: string[];
  /** Errors and warnings found when it was checked alone (foreign keys are checked at deployment). */
  errors: number;
  warnings: number;
}

function rowToSummary(row: SeedRow): TableSeedSummary {
  const file = row.storage === "file";
  const check = file && row.check_json ? (JSON.parse(row.check_json) as SeedFileCheck) : null;
  return {
    tableId: row.table_id,
    tableName: row.table_name,
    format: "csv",
    storage: file ? "file" : "inline",
    rowCount: row.row_count,
    bytes: row.bytes,
    options: JSON.parse(row.options_json) as SeedOptions,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
    ...(check?.overflows.length ? { overflows: check.overflows } : {}),
    ...(check?.unchecked.length ? { unchecked: check.unchecked } : {}),
  };
}

export async function listSeeds(projectId: string): Promise<TableSeedSummary[]> {
  return (
    (await db
      .prepare(
        "SELECT project_id, table_id, table_name, options_json, row_count, bytes, storage, file_name, check_json, updated_by_name, updated_at, '' AS content FROM table_seeds WHERE project_id = ? ORDER BY LOWER(table_name)",
      )
      .all(projectId)) as SeedRow[]
  ).map(rowToSummary);
}

/** A seed as the server reads it: with the name of its file when it is kept as one — never sent to a client as is. */
export type StoredSeed = TableSeed & { fileName: string | null };

export async function getSeed(projectId: string, tableId: string): Promise<StoredSeed | null> {
  const row = (await db
    .prepare("SELECT * FROM table_seeds WHERE project_id = ? AND table_id = ?")
    .get(projectId, tableId)) as SeedRow | undefined;
  return row ? { ...rowToSummary(row), content: row.content, fileName: row.file_name } : null;
}

/** Every seed of a project with its file — what a deployment inserts. */
export async function listSeedsWithContent(projectId: string): Promise<StoredSeed[]> {
  return ((await db.prepare("SELECT * FROM table_seeds WHERE project_id = ?").all(projectId)) as SeedRow[]).map(
    (row) => ({
      ...rowToSummary(row),
      content: row.content,
      fileName: row.file_name,
    }),
  );
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
  const options = parseSeedOptions(raw.options);
  const parsed = parseCsv(raw.content, options.separator as SeedSeparator);
  const rowCount = Math.max(0, parsed.length - (options.header ? 1 : 0));
  if (rowCount > SEED_MAX_ROWS) {
    throw new ApiError("SEED_INVALID", { message: `seed has ${rowCount} rows, the limit is ${SEED_MAX_ROWS}` });
  }
  const width = parsed[0]?.length ?? 0;
  if (options.mapping.length !== width)
    throw new ApiError("SEED_INVALID", { message: "the mapping needs one entry per CSV column" });
  return { content: raw.content, options, rowCount };
}

/** The separator, header flag, mode and mapping a client sent for a seed: checked, not yet matched against a file. */
export function parseSeedOptions(input: unknown): SeedOptions {
  const options = (input ?? {}) as Record<string, unknown>;
  if (!SEED_SEPARATORS.includes(options.separator as SeedSeparator)) throw new ApiError("SEED_INVALID");
  if (typeof options.header !== "boolean") throw new ApiError("SEED_INVALID");
  if (!SEED_MODES.includes(options.mode as SeedMode)) throw new ApiError("SEED_INVALID");
  const mapping = options.mapping;
  if (!Array.isArray(mapping) || !mapping.every((m) => m === null || (typeof m === "string" && m.length <= 200))) {
    throw new ApiError("SEED_INVALID");
  }
  return {
    separator: options.separator as SeedSeparator,
    header: options.header,
    mapping: mapping as (string | null)[],
    mode: options.mode as SeedMode,
  };
}

/** The name of a table's seed file, if its seed is kept as one. */
export async function seedFileNameOf(projectId: string, tableId: string): Promise<string | null> {
  const row = (await db
    .prepare("SELECT file_name FROM table_seeds WHERE project_id = ? AND table_id = ?")
    .get(projectId, tableId)) as { file_name: string | null } | undefined;
  return row?.file_name ?? null;
}

export async function upsertSeed(input: {
  projectId: string;
  tableId: string;
  tableName: string;
  content: string;
  options: SeedOptions;
  rowCount: number;
  updatedBy: string;
  updatedByName: string;
  /** A seed kept as a file: `content` is empty, `fileName` names the file under the seed directory. */
  file?: { fileName: string; bytes: number; check: SeedFileCheck };
}): Promise<StoredSeed> {
  await db
    .prepare(
      `INSERT INTO table_seeds (project_id, table_id, table_name, content, options_json, row_count, bytes, storage, file_name, check_json, updated_by, updated_by_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, utc_now())
     ON CONFLICT(project_id, table_id) DO UPDATE SET
       table_name = excluded.table_name, content = excluded.content, options_json = excluded.options_json,
       row_count = excluded.row_count, bytes = excluded.bytes, storage = excluded.storage, file_name = excluded.file_name,
       check_json = excluded.check_json, updated_by = excluded.updated_by,
       updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`,
    )
    .run(
      input.projectId,
      input.tableId,
      input.tableName,
      input.content,
      JSON.stringify(input.options),
      input.rowCount,
      input.file ? input.file.bytes : Buffer.byteLength(input.content, "utf8"),
      input.file ? "file" : "inline",
      input.file?.fileName ?? null,
      input.file ? JSON.stringify(input.file.check) : null,
      input.updatedBy,
      input.updatedByName,
    );
  return (await getSeed(input.projectId, input.tableId))!;
}

export async function deleteSeed(projectId: string, tableId: string): Promise<boolean> {
  return (
    (await db.prepare("DELETE FROM table_seeds WHERE project_id = ? AND table_id = ?").run(projectId, tableId))
      .changes > 0
  );
}
