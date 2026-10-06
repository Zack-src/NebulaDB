import {
  normalizeSeedValue,
  parseCsv,
  seedColumnValues,
  seedInsertOrder,
  seedRows,
  validateSeed,
  type DatabaseEngine,
  type Field,
  type Project,
  type SeedPlanEntry,
  type SeedResult,
  type Table,
  type TableSeed,
} from "@nebuladb/shared";
import { q, type MigrationDialect } from "@nebuladb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import type { DatabaseDriver } from "../connections/drivers/interface.js";
import { listSeedsWithContent } from "./repository.js";

/** One seed, read against the table it belongs to as the schema has it now. */
interface PreparedSeed {
  seed: TableSeed;
  table: Table;
  columns: Field[];
  rows: (string | null)[][];
  errors: number;
  warnings: number;
}

export interface PreparedSeeds {
  /** In insertion order: parents before the tables pointing at them. */
  seeds: PreparedSeed[];
  /** Table names, one list per cycle among seeded tables. */
  cycles: string[][];
}

/**
 * The project's seeds, validated against the schema being deployed and put in
 * foreign-key order. A seed whose table no longer exists is left out (it
 * belongs to nothing being deployed). Parents are validated first so a
 * child's foreign keys are checked against the rows its parent will insert.
 */
export function prepareSeeds(projectId: string, project: Project): PreparedSeeds {
  const tables = new Map(project.tables.map((table) => [table.id, table]));
  const seeds = listSeedsWithContent(projectId).filter((seed) => tables.has(seed.tableId));
  const { order, cycles } = seedInsertOrder(
    seeds.map((seed) => seed.tableId),
    project.refs,
  );
  const byTable = new Map(seeds.map((seed) => [seed.tableId, seed]));
  const parentValues = new Map<string, Set<string>>();
  const prepared: PreparedSeed[] = [];
  for (const tableId of order) {
    const seed = byTable.get(tableId)!;
    const table = tables.get(tableId)!;
    const parsed = parseCsv(seed.content, seed.options.separator);
    const { issues, total } = validateSeed(table, parsed, seed.options, { parentValues, refs: project.refs });
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    const { columns, rows } = seedRows(parsed, seed.options, table);
    for (const [key, values] of seedColumnValues(table, parsed, seed.options)) parentValues.set(key, values);
    prepared.push({ seed, table, columns, rows, errors: total - warnings, warnings });
  }
  return {
    seeds: prepared,
    cycles: cycles.map((cycle) => cycle.map((id) => tables.get(id)?.name ?? id)),
  };
}

/** Refuses a deployment whose seeds cannot all go in: a seed with errors, or tables that depend on each other in a cycle. */
export function assertSeedsDeployable(prepared: PreparedSeeds): void {
  const broken = prepared.seeds.filter((seed) => seed.errors > 0).map((seed) => seed.table.name);
  if (broken.length > 0 || prepared.cycles.length > 0) {
    throw new ApiError("SEEDS_NOT_DEPLOYABLE", { details: { tables: broken, cycles: prepared.cycles } });
  }
}

async function existingRows(driver: DatabaseDriver, table: string, engine: DatabaseEngine): Promise<number | null> {
  try {
    return (await driver.queryScalar(`SELECT COUNT(*) FROM ${q(table, engine as MigrationDialect)}`)) ?? 0;
  } catch {
    return null;
  }
}

/**
 * What the dry-run shows: per seeded table, how many rows and whether they
 * would go in. `createdTables` are the tables the deployment creates — empty
 * by definition, so not counted on the target.
 */
export async function planSeeds(
  driver: DatabaseDriver,
  prepared: PreparedSeeds,
  engine: DatabaseEngine,
  createdTables: ReadonlySet<string>,
): Promise<SeedPlanEntry[]> {
  const plan: SeedPlanEntry[] = [];
  for (const { seed, table, rows, errors, warnings } of prepared.seeds) {
    const existing = createdTables.has(table.name.toLowerCase()) ? 0 : await existingRows(driver, table.name, engine);
    const action: SeedPlanEntry["action"] =
      existing === null ? "unmeasured" : seed.options.mode === "if-empty" && existing > 0 ? "skip-not-empty" : "insert";
    plan.push({
      tableId: table.id,
      tableName: table.name,
      rows: rows.length,
      mode: seed.options.mode,
      action,
      existingRows: existing,
      errors,
      warnings,
    });
  }
  return plan;
}

/**
 * Inserts the seeds after the DDL, parents first, each table in its own
 * transaction. A table that fails stops the rest (its children would fail on
 * their foreign keys anyway) and is reported; what went in before it stays.
 */
export async function applySeeds(
  driver: DatabaseDriver,
  prepared: PreparedSeeds,
  engine: DatabaseEngine,
): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const { seed, table, columns, rows } of prepared.seeds) {
    if (seed.options.mode === "if-empty") {
      const existing = await existingRows(driver, table.name, engine);
      if (existing === null || existing > 0) {
        results.push({ tableName: table.name, inserted: 0, skipped: true });
        continue;
      }
    }
    try {
      const values = rows.map((row) => row.map((value, i) => normalizeSeedValue(value, columns[i], engine)));
      const inserted = await driver.insertRows(
        table.name,
        columns.map((field) => field.name),
        values,
      );
      results.push({ tableName: table.name, inserted, skipped: false });
    } catch (err) {
      results.push({
        tableName: table.name,
        inserted: 0,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }
  return results;
}
