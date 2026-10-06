import {
  SEED_MAX_BYTES,
  SEED_MAX_ROWS,
  toCsv,
  type DatabaseConnectionConfig,
  type SeedFromDatabase,
  type Table,
} from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";
import { backupPageSql } from "../backups/format.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";

/** Rows read per query — the backup runner's page, for the same reasons. */
const PAGE_ROWS = 2000;

class BinaryColumn extends Error {}

/** A database value as a seed's CSV spells it; `null` stays `NULL`. Binary has no spelling here. */
function toSeedCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) throw new BinaryColumn();
  return JSON.stringify(value);
}

/**
 * The rows a table holds in a database right now, as a seed's CSV — returned,
 * not saved: the editor shows it checked against the table like any file, and
 * the person decides.
 *
 * Only the columns the schema and the database both have are read (matched by
 * name, so a column added on one side only is left out and named). A binary
 * column cannot be written as CSV text: it is left out and named too. Reading
 * stops at a seed's own limits (rows, bytes) and says so rather than failing —
 * the first rows of a large table are still a useful start.
 */
export async function readTableAsSeed(connection: DatabaseConnectionConfig, table: Table): Promise<SeedFromDatabase> {
  const driver = await createDatabaseDriver(connection);
  try {
    const live = (await driver.introspectSchema()).tables.find(
      (candidate) => candidate.name.toLowerCase() === table.name.toLowerCase(),
    );
    if (!live) throw new ApiError("DATABASE_TABLE_NOT_FOUND", { details: { table: table.name } });

    const liveByName = new Map(live.fields.map((field) => [field.name.toLowerCase(), field]));
    let fields = table.fields.filter((field) => liveByName.has(field.name.toLowerCase()));
    const skippedColumns = table.fields.filter((field) => !fields.includes(field)).map((field) => field.name);
    const primaryKey = live.fields.filter((field) => field.pk).map((field) => field.name);

    const rows: (string | null)[][] = [];
    let bytes = 0;
    let truncated = false;
    reading: for (let offset = 0; fields.length > 0; offset += PAGE_ROWS) {
      const columns = fields.map((field) => liveByName.get(field.name.toLowerCase())!.name);
      const page = await driver.queryRows(
        backupPageSql(connection.engine, live.name, columns, primaryKey, PAGE_ROWS, offset),
      );
      for (const raw of page) {
        let cells: (string | null)[];
        try {
          cells = raw.map(toSeedCell);
        } catch (err) {
          if (!(err instanceof BinaryColumn)) throw err;
          // Start over without the binary columns of this row: simpler than
          // patching the rows already read, and it happens once per table.
          const binary = new Set(fields.filter((_, i) => raw[i] instanceof Uint8Array));
          skippedColumns.push(...[...binary].map((field) => field.name));
          fields = fields.filter((field) => !binary.has(field));
          rows.length = 0;
          bytes = 0;
          offset = -PAGE_ROWS;
          continue reading;
        }
        bytes += cells.reduce((sum, cell) => sum + (cell === null ? 1 : Buffer.byteLength(cell, "utf8") + 3), 0);
        // Kept under the limit with room for the header line and the quoting `toCsv` adds.
        if (rows.length >= SEED_MAX_ROWS || bytes > SEED_MAX_BYTES * 0.9) {
          truncated = true;
          break reading;
        }
        rows.push(cells);
      }
      if (page.length < PAGE_ROWS) break;
    }

    return {
      content: toCsv(
        fields.map((field) => field.name),
        rows,
      ),
      mapping: fields.map((field) => field.id),
      rowCount: rows.length,
      truncated,
      skippedColumns,
    };
  } finally {
    await driver.close().catch(() => {});
  }
}
