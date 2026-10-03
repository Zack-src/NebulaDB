import type {
  ConflictResolutionStrategy,
  SchemaDiffRiskType,
  SchemaRisk,
  StrategyOption,
  Table,
} from "@athanordb/shared";
import type { MigrationDiff, MigrationTableChange } from "./migrationDiff.js";
import { q, type MigrationDialect } from "./migrationGenerator.js";

// Pure: builds SQL, runs nothing. The server runs each probe against the
// target (`queryScalar`) and turns the number back into a risk here.

/**
 * One measurement to take on the target before a deployment: an **aggregate**
 * query (a count or a maximum — never row data) whose single number decides
 * whether a change in the plan loses data or will fail.
 */
export interface RiskProbe {
  type: SchemaDiffRiskType;
  tableName: string;
  columnName?: string;
  /** Several columns (a new unique index) or the relation (a new foreign key), for display. */
  detail?: string;
  /** Where the user's answer goes in the `MigrationResolutionMap` the generator reads. */
  resolutionKey: string;
  /** Returns one number. */
  sql: string;
  /** `LENGTH_REDUCTION`: the new maximum length. */
  limit?: number;
}

const columnKey = (table: string, column: string) => `column:${table.toLowerCase()}.${column.toLowerCase()}`;

function lengthFunction(dialect: MigrationDialect): string {
  if (dialect === "mssql") return "LEN";
  if (dialect === "postgres" || dialect === "mysql") return "CHAR_LENGTH";
  return "LENGTH";
}

/** `varchar(255)`, `character varying(80)`, `nvarchar(40)`, `char(2)`, `varchar2(30 char)` → the length. */
export function declaredLength(type: string | undefined): number | null {
  const match = /^\s*(?:n?var)?char(?:acter)?(?:\s+varying)?2?\s*\(\s*(\d+)/i.exec(type ?? "");
  return match ? Number(match[1]) : null;
}

/** A text type with no limit — `text`, a bare `varchar` — so any limit is a reduction. */
function isUnboundedText(type: string | undefined): boolean {
  const t = (type ?? "").trim().toLowerCase();
  return /^(text|mediumtext|longtext|clob|nclob|string|n?varchar|character varying)$/.test(t) || /\(max\)$/.test(t);
}

function fieldNames(table: Table | undefined, fieldIds: readonly string[]): string[] {
  return fieldIds.map((id) => table?.fields.find((field) => field.id === id)?.name ?? id);
}

function duplicatesSql(table: string, columns: string[], dialect: MigrationDialect): string {
  const cols = columns.map((c) => q(c, dialect));
  const notNull = cols.map((c) => `${c} IS NOT NULL`).join(" AND ");
  return `SELECT COUNT(*) FROM (SELECT ${cols.join(", ")} FROM ${q(table, dialect)} WHERE ${notNull} GROUP BY ${cols.join(", ")} HAVING COUNT(*) > 1) d`;
}

function probesForModifiedTable(table: MigrationTableChange, dialect: MigrationDialect): RiskProbe[] {
  const probes: RiskProbe[] = [];
  const T = q(table.name, dialect);
  for (const field of table.fields) {
    const C = q(field.name, dialect);
    const key = columnKey(table.name, field.name);
    if (field.status === "dropped") {
      probes.push({
        type: "DROP_COLUMN_WITH_DATA",
        tableName: table.name,
        columnName: field.name,
        resolutionKey: key,
        sql: `SELECT COUNT(*) FROM ${T} WHERE ${C} IS NOT NULL`,
      });
      continue;
    }
    if (field.status === "added") {
      const after = field.after;
      if (after?.notNull && !after.pk && !after.increment && (after.default === undefined || after.default === "")) {
        probes.push({
          type: "ADD_NOT_NULL_NO_DEFAULT",
          tableName: table.name,
          columnName: field.name,
          resolutionKey: key,
          sql: `SELECT COUNT(*) FROM ${T}`,
        });
      }
      continue;
    }
    // Modified.
    if (field.typeChanged) {
      const newLimit = declaredLength(field.after?.type);
      const oldLimit = declaredLength(field.before?.type);
      const shrinks =
        newLimit !== null && (oldLimit !== null ? newLimit < oldLimit : isUnboundedText(field.before?.type));
      if (shrinks) {
        probes.push({
          type: "LENGTH_REDUCTION",
          tableName: table.name,
          columnName: field.name,
          resolutionKey: key,
          sql: `SELECT MAX(${lengthFunction(dialect)}(${C})) FROM ${T}`,
          limit: newLimit,
        });
      } else {
        probes.push({
          type: "ALTER_COLUMN_TYPE",
          tableName: table.name,
          columnName: field.name,
          resolutionKey: key,
          sql: `SELECT COUNT(*) FROM ${T} WHERE ${C} IS NOT NULL`,
        });
      }
    }
    if (field.notNullChanged && field.after?.notNull) {
      probes.push({
        type: "NULL_TO_NOT_NULL",
        tableName: table.name,
        columnName: field.name,
        resolutionKey: key,
        sql: `SELECT COUNT(*) FROM ${T} WHERE ${C} IS NULL`,
      });
    }
    const becomesUnique =
      (field.uniqueChanged && field.after?.unique) || (field.pkChanged && field.after?.pk && !field.before?.pk);
    if (becomesUnique) {
      probes.push({
        type: "UNIQUE_VIOLATION",
        tableName: table.name,
        columnName: field.name,
        detail: field.name,
        resolutionKey: `unique:${table.name.toLowerCase()}.${field.name.toLowerCase()}`,
        sql: duplicatesSql(table.name, [field.name], dialect),
      });
    }
  }
  for (const index of table.addedIndexes) {
    if (!index.unique && !index.pk) continue;
    const columns = fieldNames(table.after, index.fieldIds);
    probes.push({
      type: "UNIQUE_VIOLATION",
      tableName: table.name,
      detail: columns.join(", "),
      resolutionKey: `unique:${table.name.toLowerCase()}.${columns.map((c) => c.toLowerCase()).join(",")}`,
      sql: duplicatesSql(table.name, columns, dialect),
    });
  }
  return probes;
}

/**
 * Every measurement worth taking for this plan. Only tables and relations
 * that already exist on the target are probed — a table the plan creates is
 * empty, so nothing on it can lose data or collide.
 */
export function planRiskProbes(diff: MigrationDiff, dialect: MigrationDialect): RiskProbe[] {
  const probes: RiskProbe[] = [];
  const created = new Set(diff.tables.filter((t) => t.status === "added").map((t) => t.name.toLowerCase()));
  for (const table of diff.tables) {
    if (table.status === "dropped") {
      probes.push({
        type: "DROP_TABLE_WITH_DATA",
        tableName: table.name,
        resolutionKey: `table:${table.name.toLowerCase()}`,
        sql: `SELECT COUNT(*) FROM ${q(table.name, dialect)}`,
      });
    } else if (table.status === "modified") {
      probes.push(...probesForModifiedTable(table, dialect));
    }
  }
  for (const ref of diff.refs) {
    if (ref.status !== "added") continue;
    if (created.has(ref.fromTable.toLowerCase()) || created.has(ref.toTable.toLowerCase())) continue;
    // SQLite cannot add a foreign key to an existing table; the generator leaves it out.
    if (dialect === "sqlite") continue;
    const F = q(ref.fromTable, dialect);
    const FC = q(ref.fromField, dialect);
    probes.push({
      type: "FK_VIOLATION",
      tableName: ref.fromTable,
      columnName: ref.fromField,
      detail: `${ref.fromTable}.${ref.fromField} → ${ref.toTable}.${ref.toField}`,
      resolutionKey: `ref:${ref.fromTable.toLowerCase()}.${ref.fromField.toLowerCase()}->${ref.toTable.toLowerCase()}.${ref.toField.toLowerCase()}`,
      sql: `SELECT COUNT(*) FROM ${F} f WHERE f.${FC} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(ref.toTable, dialect)} t WHERE t.${q(ref.toField, dialect)} = f.${FC})`,
    });
  }
  return probes;
}

const STRATEGY: Record<ConflictResolutionStrategy, Omit<StrategyOption, "key"> | undefined> = {
  DROP_DATA_CONFIRMED: {
    labelKey: "connections.strategy.dropData",
    descriptionKey: "connections.strategy.dropDataDesc",
  },
  KEEP_IN_DB: { labelKey: "connections.strategy.keepInDb", descriptionKey: "connections.strategy.keepInDbDesc" },
  FORCE_CAST: { labelKey: "connections.strategy.forceCast", descriptionKey: "connections.strategy.forceCastDesc" },
  CLEAR_COLUMN_DATA: {
    labelKey: "connections.strategy.clearData",
    descriptionKey: "connections.strategy.clearDataDesc",
  },
  BACKFILL_DEFAULT: {
    labelKey: "connections.strategy.backfillDefault",
    descriptionKey: "connections.strategy.backfillDefaultDesc",
    requiresInput: "default_value",
  },
  DELETE_OFFENDING_ROWS: {
    labelKey: "connections.strategy.deleteRows",
    descriptionKey: "connections.strategy.deleteRowsDesc",
  },
  CANCEL: { labelKey: "connections.strategy.cancel", descriptionKey: "connections.strategy.cancelDesc" },
  PROCEED: { labelKey: "connections.strategy.proceed", descriptionKey: "connections.strategy.proceedDesc" },
  USE_TRANSLATED_TYPE: undefined,
  KEEP_AS_WRITTEN: undefined,
};

function options(
  keys: ConflictResolutionStrategy[],
  overrides: Partial<Record<ConflictResolutionStrategy, string>> = {},
) {
  return keys.map((key) => ({
    key,
    ...STRATEGY[key]!,
    ...(overrides[key] ? { labelKey: overrides[key]!, descriptionKey: `${overrides[key]!}Desc` } : {}),
  }));
}

/**
 * The risk a probe's number means, or `null` when the change is safe.
 * `value === null`: the measurement could not be taken (timeout, missing
 * column) — reported as a warning rather than silently passed.
 */
export function riskFromProbe(probe: RiskProbe, value: number | null): SchemaRisk | null {
  const base = {
    id: `risk-${probe.resolutionKey}-${probe.type}`,
    type: probe.type,
    tableName: probe.tableName,
    columnName: probe.columnName,
    detail: probe.detail,
    resolutionKey: probe.resolutionKey,
  };
  const make = (
    severity: SchemaRisk["severity"],
    affectedRowCount: number,
    keys: ConflictResolutionStrategy[],
    fallback: ConflictResolutionStrategy,
    extra: Partial<SchemaRisk> = {},
  ): SchemaRisk => ({
    ...base,
    severity,
    affectedRowCount,
    availableStrategies: options(
      keys,
      probe.type === "DROP_COLUMN_WITH_DATA" ? { KEEP_IN_DB: "connections.strategy.keepColumn" } : {},
    ),
    defaultStrategy: fallback,
    selectedStrategy: fallback,
    ...(value === null ? { unmeasured: true } : {}),
    ...extra,
  });
  const n = value ?? 0;
  if (value !== null && n <= 0 && probe.type !== "LENGTH_REDUCTION") return null;

  switch (probe.type) {
    case "DROP_TABLE_WITH_DATA":
    case "DROP_COLUMN_WITH_DATA":
      return make(
        value === null ? "warning" : "critical",
        n,
        ["DROP_DATA_CONFIRMED", "KEEP_IN_DB", "CANCEL"],
        "KEEP_IN_DB",
      );
    case "ALTER_COLUMN_TYPE":
      return make("warning", n, ["FORCE_CAST", "CLEAR_COLUMN_DATA", "CANCEL"], "FORCE_CAST");
    case "NULL_TO_NOT_NULL":
      return make(
        value === null ? "warning" : "critical",
        n,
        ["BACKFILL_DEFAULT", "DELETE_OFFENDING_ROWS", "CANCEL"],
        "BACKFILL_DEFAULT",
      );
    case "ADD_NOT_NULL_NO_DEFAULT":
      return make(value === null ? "warning" : "critical", n, ["BACKFILL_DEFAULT", "CANCEL"], "BACKFILL_DEFAULT");
    case "LENGTH_REDUCTION": {
      const limit = probe.limit ?? 0;
      if (value !== null && n <= limit) {
        // Fits: shown so the reader sees it was checked, nothing to decide.
        return make("info", 0, ["FORCE_CAST"], "FORCE_CAST", { measuredMax: n, limit });
      }
      if (value === null) return make("warning", 0, ["PROCEED", "CLEAR_COLUMN_DATA", "CANCEL"], "PROCEED", { limit });
      return make("critical", 0, ["CLEAR_COLUMN_DATA", "CANCEL"], "CANCEL", { measuredMax: n, limit });
    }
    case "UNIQUE_VIOLATION":
    case "FK_VIOLATION":
      // The database would refuse the constraint: the data has to be fixed first.
      if (value === null) return make("warning", 0, ["PROCEED", "CANCEL"], "PROCEED");
      return make("critical", n, ["CANCEL"], "CANCEL");
    default:
      return null;
  }
}

/** Strategies that throw data away — what "accepting a risk" means in the deployment record. */
export const DATA_LOSS_STRATEGIES: ReadonlySet<ConflictResolutionStrategy> = new Set([
  "DROP_DATA_CONFIRMED",
  "CLEAR_COLUMN_DATA",
  "DELETE_OFFENDING_ROWS",
]);
