import type { DetailLevel, Field, Project, Ref, Table } from "@athanordb/shared";

/**
 * Synthetic schema generator for the canvas perf harness (see `BenchHarness`).
 *
 * Everything is deterministic and id-stable (`t3`, `t3f2`, `r7`) so a bench
 * run can name the exact table/column it mutates and two runs of the same
 * config are comparable down to the individual node.
 */

export const BENCH_PROJECT_ID = "bench-local";

export interface BenchConfig {
  /** How many tables the canvas holds. */
  tables: number;
  /** Columns per table. */
  columns: number;
  /** Detail level every table starts at — the canvas's "complet/standard/compact" toggle. */
  detail: DetailLevel;
  /** Roughly how many refs per table (1 = a chain, 2 = a chain plus a long-range ref every other table). */
  refDensity: number;
  /** Whether the DBML side panel starts open, as it does in the real editor. */
  dbml: boolean;
}

export const DEFAULT_BENCH_CONFIG: BenchConfig = {
  tables: 100,
  columns: 8,
  detail: "standard",
  refDensity: 1,
  dbml: true,
};

function parseDetail(value: string | null): DetailLevel {
  return value === "compact" || value === "full" || value === "standard" ? value : DEFAULT_BENCH_CONFIG.detail;
}

/** Reads `#bench?tables=200&columns=8&detail=full&refs=1&dbml=0` into a config. */
export function parseBenchConfig(hash: string): BenchConfig {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  const num = (key: string, fallback: number) => {
    const raw = Number(params.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  return {
    tables: Math.min(num("tables", DEFAULT_BENCH_CONFIG.tables), 2000),
    columns: Math.min(num("columns", DEFAULT_BENCH_CONFIG.columns), 100),
    detail: parseDetail(params.get("detail")),
    refDensity: num("refs", DEFAULT_BENCH_CONFIG.refDensity),
    dbml: params.get("dbml") !== "0",
  };
}

const COLUMN_TYPES = ["int", "varchar", "text", "timestamp", "boolean", "numeric", "uuid", "jsonb"];

/** Grid spacing wide enough that tables never overlap at "full" detail with 20 columns. */
const COL_SPACING = 380;
const ROW_SPACING = 560;

function buildTable(index: number, config: BenchConfig, perRow: number): Table {
  const fields: Field[] = [
    { id: `t${index}f0`, name: "id", type: "int", pk: true, increment: true },
    // The FK column every inbound ref points at — always present so ref
    // wiring doesn't depend on the column count.
    { id: `t${index}f1`, name: "parent_id", type: "int" },
  ];
  for (let c = 2; c < config.columns; c++) {
    fields.push({
      id: `t${index}f${c}`,
      name: `column_${c}`,
      type: COLUMN_TYPES[c % COLUMN_TYPES.length],
      notNull: c % 3 === 0,
      unique: c % 7 === 0,
    });
  }
  return {
    id: `t${index}`,
    name: `table_${index}`,
    fields,
    indexes: [],
    position: { x: (index % perRow) * COL_SPACING, y: Math.floor(index / perRow) * ROW_SPACING },
    detailLevel: config.detail,
  };
}

export function buildBenchProject(config: BenchConfig): Project {
  const perRow = Math.max(1, Math.round(Math.sqrt(config.tables)));
  const tables: Table[] = [];
  for (let i = 0; i < config.tables; i++) tables.push(buildTable(i, config, perRow));

  const refs: Ref[] = [];
  // A chain (i -> i-1) gives every table at least one relation; the extra
  // passes add long-range refs so edge count scales with `refDensity` without
  // turning the diagram into a complete graph.
  for (let i = 1; i < config.tables; i++) {
    refs.push({
      id: `r${refs.length}`,
      from: { tableId: `t${i}`, fieldId: `t${i}f1` },
      to: { tableId: `t${i - 1}`, fieldId: `t${i - 1}f0` },
      cardinality: "one-to-many",
    });
  }
  for (let extra = 1; extra < Math.round(config.refDensity); extra++) {
    const stride = extra * 7 + 3;
    for (let i = stride; i < config.tables; i += 2) {
      refs.push({
        id: `r${refs.length}`,
        from: { tableId: `t${i}`, fieldId: `t${i}f1` },
        to: { tableId: `t${i - stride}`, fieldId: `t${i - stride}f0` },
        cardinality: extra % 2 === 0 ? "many-to-many" : "one-to-one",
      });
    }
  }

  return {
    id: BENCH_PROJECT_ID,
    name: `bench-${config.tables}t-${config.columns}c-${config.detail}`,
    tables,
    refs,
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
}
