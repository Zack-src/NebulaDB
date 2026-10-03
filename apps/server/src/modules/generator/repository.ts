import {
  COLUMN_GENERATORS,
  GENERATOR_LOCALES,
  GENERATOR_MAX_ROWS,
  type ColumnGeneratorConfig,
  type ColumnGeneratorKind,
  type GeneratorLocale,
  type TableGeneratorConfig,
} from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

const MAX_VALUES = 200;
const MAX_TEXT = 200;

function isScalar(value: unknown): value is number | string {
  return (
    (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= MAX_TEXT)
  );
}

function parseColumn(raw: unknown): ColumnGeneratorConfig {
  const column = (raw ?? {}) as Record<string, unknown>;
  if (!COLUMN_GENERATORS.includes(column.kind as ColumnGeneratorKind)) throw new ApiError("GENERATOR_INVALID");
  const out: ColumnGeneratorConfig = { kind: column.kind as ColumnGeneratorKind };
  if (column.min !== undefined) {
    if (!isScalar(column.min)) throw new ApiError("GENERATOR_INVALID");
    out.min = column.min;
  }
  if (column.max !== undefined) {
    if (!isScalar(column.max)) throw new ApiError("GENERATOR_INVALID");
    out.max = column.max;
  }
  if (column.scale !== undefined) {
    if (typeof column.scale !== "number" || column.scale < 0 || column.scale > 10)
      throw new ApiError("GENERATOR_INVALID");
    out.scale = Math.floor(column.scale);
  }
  if (column.values !== undefined) {
    if (
      !Array.isArray(column.values) ||
      column.values.length > MAX_VALUES ||
      !column.values.every((v) => typeof v === "string" && v.length <= MAX_TEXT)
    ) {
      throw new ApiError("GENERATOR_INVALID");
    }
    out.values = column.values as string[];
  }
  if (column.weights !== undefined) {
    if (
      !Array.isArray(column.weights) ||
      column.weights.length > MAX_VALUES ||
      !column.weights.every((w) => typeof w === "number" && Number.isFinite(w) && w >= 0)
    ) {
      throw new ApiError("GENERATOR_INVALID");
    }
    out.weights = column.weights as number[];
  }
  if (column.value !== undefined) {
    if (typeof column.value !== "string" || column.value.length > MAX_TEXT) throw new ApiError("GENERATOR_INVALID");
    out.value = column.value;
  }
  if (column.nullRatio !== undefined) {
    if (typeof column.nullRatio !== "number" || column.nullRatio < 0 || column.nullRatio > 1) {
      throw new ApiError("GENERATOR_INVALID");
    }
    out.nullRatio = column.nullRatio;
  }
  return out;
}

/** Checks a generation configuration sent by a client, field by field. */
export function parseGeneratorConfig(body: unknown): TableGeneratorConfig {
  const raw = (body ?? {}) as Record<string, unknown>;
  if (typeof raw.rows !== "number" || !Number.isInteger(raw.rows) || raw.rows < 1 || raw.rows > GENERATOR_MAX_ROWS) {
    throw new ApiError("GENERATOR_INVALID", { message: `rows must be an integer between 1 and ${GENERATOR_MAX_ROWS}` });
  }
  if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed)) throw new ApiError("GENERATOR_INVALID");
  if (!GENERATOR_LOCALES.includes(raw.locale as GeneratorLocale)) throw new ApiError("GENERATOR_INVALID");
  const columnsRaw = raw.columns ?? {};
  if (typeof columnsRaw !== "object" || Array.isArray(columnsRaw) || Object.keys(columnsRaw).length > 500) {
    throw new ApiError("GENERATOR_INVALID");
  }
  const columns: Record<string, ColumnGeneratorConfig> = {};
  for (const [fieldId, column] of Object.entries(columnsRaw as Record<string, unknown>)) {
    if (fieldId.length > 200) throw new ApiError("GENERATOR_INVALID");
    columns[fieldId] = parseColumn(column);
  }
  return { rows: raw.rows, seed: raw.seed, locale: raw.locale as GeneratorLocale, columns };
}

export function getGeneratorConfig(projectId: string, tableId: string): TableGeneratorConfig | null {
  const row = db
    .prepare("SELECT config_json FROM generator_configs WHERE project_id = ? AND table_id = ?")
    .get(projectId, tableId) as { config_json: string } | undefined;
  return row ? (JSON.parse(row.config_json) as TableGeneratorConfig) : null;
}

export function saveGeneratorConfig(
  projectId: string,
  tableId: string,
  config: TableGeneratorConfig,
  by: string,
): void {
  db.prepare(
    `INSERT INTO generator_configs (project_id, table_id, config_json, updated_by_name, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, table_id) DO UPDATE SET
       config_json = excluded.config_json, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`,
  ).run(projectId, tableId, JSON.stringify(config), by);
}
