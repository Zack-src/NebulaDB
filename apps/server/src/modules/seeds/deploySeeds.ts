import {
  SeedValidator,
  normalizeSeedValue,
  seedInsertOrder,
  type DatabaseEngine,
  type Field,
  type Project,
  type SeedPlanEntry,
  type SeedResult,
  type Table,
} from "@nebuladb/shared";
import { q, type MigrationDialect } from "@nebuladb/dbml-engine";
import { config } from "../../config.js";
import { ApiError } from "../../shared/errors.js";
import type { DatabaseDriver, RowValue } from "../connections/drivers/interface.js";
import { listSeedsWithContent, type StoredSeed } from "./repository.js";
import { seedRowStream } from "./seedFiles.js";

/** Rows sent to the database in one go while a seed is read: small enough to stay cheap in memory, big enough to keep the round trips few. */
const INSERT_BATCH_ROWS = 2000;

/** One seed, read against the table it belongs to as the schema has it now. */
interface PreparedSeed {
  seed: StoredSeed;
  table: Table;
  columns: Field[];
  /** Data rows the seed holds (header excluded). */
  rowCount: number;
  errors: number;
  warnings: number;
  /** Checks given up on for lack of room: the seed is then only partly checked. */
  unchecked: string[];
  /** The rows to insert, in batches, as the target engine wants them — read from memory or from the file as they are asked for. */
  batches(engine: DatabaseEngine): AsyncGenerator<RowValue[][]>;
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
 *
 * Every seed is read as a stream, row by row: a file of several gigabytes is checked without being held. The
 * keys a child's foreign keys need are gathered from the parent as it goes, up to `config.seedMaxKeys` values
 * in all; past that a check is given up on (`unchecked`) rather than the server running out of memory.
 */
export async function prepareSeeds(projectId: string, project: Project): Promise<PreparedSeeds> {
  const tables = new Map(project.tables.map((table) => [table.id, table]));
  const seeds = (await listSeedsWithContent(projectId)).filter((seed) => tables.has(seed.tableId));
  const { order, cycles } = seedInsertOrder(
    seeds.map((seed) => seed.tableId),
    project.refs,
  );
  const seededIds = new Set(seeds.map((seed) => seed.tableId));
  const byTable = new Map(seeds.map((seed) => [seed.tableId, seed]));
  const parentValues = new Map<string, Set<string>>();
  const incompleteParents = new Set<string>();
  const prepared: PreparedSeed[] = [];
  for (const tableId of order) {
    const seed = byTable.get(tableId)!;
    const table = tables.get(tableId)!;
    // Only the columns another seeded table points at are worth keeping the values of.
    const wanted = new Set(
      project.refs
        .filter((ref) => ref.to.tableId === tableId && ref.from.tableId !== tableId && seededIds.has(ref.from.tableId))
        .map((ref) => ref.to.fieldId),
    );
    const validator = new SeedValidator(
      table,
      seed.options,
      { parentValues, incompleteParents, refs: project.refs },
      { maxKeys: config.seedMaxKeys, collect: wanted },
    );
    for await (const cells of seedRowStream(seed)) validator.add(cells);
    const result = validator.finish();
    for (const [key, values] of result.values) parentValues.set(key, values);
    for (const fieldId of wanted) {
      const key = `${tableId}.${fieldId}`;
      if (!result.values.has(key)) incompleteParents.add(key);
    }
    const columns = seed.options.mapping
      .map((fieldId) => (fieldId ? table.fields.find((field) => field.id === fieldId) : undefined))
      .filter((field): field is Field => field !== undefined);
    const picked = seed.options.mapping.flatMap((fieldId, index) =>
      fieldId && table.fields.some((field) => field.id === fieldId) ? [index] : [],
    );
    prepared.push({
      seed,
      table,
      columns,
      rowCount: result.rows,
      errors: result.total - result.warnings,
      warnings: result.warnings,
      unchecked: result.unchecked,
      async *batches(engine) {
        let batch: RowValue[][] = [];
        let header = seed.options.header;
        for await (const cells of seedRowStream(seed)) {
          if (header) {
            header = false;
            continue;
          }
          batch.push(picked.map((index, i) => normalizeSeedValue(cells[index] ?? null, columns[i], engine)));
          if (batch.length >= INSERT_BATCH_ROWS) {
            yield batch;
            batch = [];
          }
        }
        if (batch.length > 0) yield batch;
      },
    });
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
  for (const { seed, table, rowCount, errors, warnings, unchecked } of prepared.seeds) {
    const existing = createdTables.has(table.name.toLowerCase()) ? 0 : await existingRows(driver, table.name, engine);
    const action: SeedPlanEntry["action"] =
      existing === null ? "unmeasured" : seed.options.mode === "if-empty" && existing > 0 ? "skip-not-empty" : "insert";
    plan.push({
      tableId: table.id,
      tableName: table.name,
      rows: rowCount,
      mode: seed.options.mode,
      action,
      existingRows: existing,
      errors,
      warnings,
      ...(unchecked.length > 0 ? { unchecked } : {}),
    });
  }
  return plan;
}

/**
 * Inserts the seeds after the DDL, parents first, each table in its own
 * transaction, however many batches its rows take. A table that fails stops the rest (its children would fail
 * on their foreign keys anyway) and is reported; what went in before it stays.
 */
export async function applySeeds(
  driver: DatabaseDriver,
  prepared: PreparedSeeds,
  engine: DatabaseEngine,
): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const { seed, table, columns, batches } of prepared.seeds) {
    if (seed.options.mode === "if-empty") {
      const existing = await existingRows(driver, table.name, engine);
      if (existing === null || existing > 0) {
        results.push({ tableName: table.name, inserted: 0, skipped: true });
        continue;
      }
    }
    try {
      const inserted = await driver.insertRowBatches(
        table.name,
        columns.map((field) => field.name),
        batches(engine),
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
