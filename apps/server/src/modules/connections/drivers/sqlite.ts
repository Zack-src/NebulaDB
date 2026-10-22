import fs from "node:fs";
import { q } from "@nebuladb/dbml-engine";
import path from "node:path";
import Database from "better-sqlite3";
import type { DatabaseConnectionConfig, Project, Ref, Table, TableIndex } from "@nebuladb/shared";
import { config as appConfig } from "../../../config.js";
import { ApiError } from "../../../shared/errors.js";
import { oneBatch, DatabaseDriver, MigrationExecutionResult, RowValue, TestConnectionResult } from "./interface.js";

/** Follows symlinks as far as the path exists, so a link inside the allowed directory can't point back out of it. */
function realPath(target: string): string {
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync(resolved);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

/**
 * Restricts where a "live" SQLite target may be. NebulaDB's own data used to be a SQLite file
 * too, and opening that one was refused outright; it now lives in PostgreSQL, behind credentials
 * of its own, so what is left is the path allowlist `NEBULADB_SQLITE_DIR` turns on.
 */
export function assertSqlitePathAllowed(requestedPath: string): void {
  if (requestedPath === ":memory:") return;
  // Opt-in, because an existing install's connections may legitimately point
  // anywhere on disk and must keep working after an upgrade.
  if (appConfig.sqliteAllowedDir) {
    const allowed = realPath(appConfig.sqliteAllowedDir);
    const relative = path.relative(allowed, realPath(requestedPath));
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ApiError("CONNECTION_TARGET_FORBIDDEN", {
        message: "SQLite connections are restricted to the directory configured in NEBULADB_SQLITE_DIR",
      });
    }
  }
}

export class SqliteDriver implements DatabaseDriver {
  private db: Database.Database;

  constructor(config: DatabaseConnectionConfig) {
    const requestedPath = config.filePath || config.database || ":memory:";
    assertSqlitePathAllowed(requestedPath);
    this.db = new Database(requestedPath);
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const row = this.db.prepare("SELECT sqlite_version() AS version").get() as { version: string };
      return {
        ok: true,
        version: `SQLite ${row?.version}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async introspectSchema(): Promise<Project> {
    const tablesRows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const tables: Table[] = [];
    const refs: Ref[] = [];

    for (let idx = 0; idx < tablesRows.length; idx++) {
      const tableName = tablesRows[idx].name;
      const colInfo = this.db.prepare(`PRAGMA table_info("${tableName}")`).all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];

      const fields = colInfo.map((c) => ({
        id: `${tableName}.${c.name}`,
        name: c.name,
        type: c.type || "text",
        pk: c.pk > 0,
        notNull: c.notnull === 1,
        default: c.dflt_value !== null ? String(c.dflt_value) : undefined,
      }));

      // Foreign keys
      const fkInfo = this.db.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as {
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
      }[];

      for (const fk of fkInfo) {
        refs.push({
          id: `fk-${tableName}-${fk.id}-${fk.from}`,
          from: {
            tableId: tableName,
            fieldId: `${tableName}.${fk.from}`,
          },
          to: {
            tableId: fk.table,
            fieldId: `${fk.table}.${fk.to}`,
          },
          cardinality: "one-to-many" as const,
        });
      }

      tables.push({
        id: tableName,
        name: tableName,
        fields,
        indexes: [] as TableIndex[],
        position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
        detailLevel: "standard" as const,
      });
    }

    return {
      id: "live-sqlite-project",
      name: "SQLite Live",
      tables,
      refs,
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    };
  }

  /**
   * Runs one aggregate query (a count or a maximum, see `planRiskProbes`)
   * and returns its single number — `null` when there is none (an empty
   * `MAX`). Never used for row data.
   */
  async queryScalar(sql: string): Promise<number | null> {
    const value = this.db.prepare(sql).pluck().get();
    return value === null || value === undefined ? null : Number(value);
  }

  /**
   * Inserts seed rows in one transaction, in batches, with bound parameters —
   * never values spliced into the SQL. All or nothing: a failing row rolls the
   * whole table back. Returns the number of rows inserted.
   */
  async insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number> {
    return this.insertRowBatches(table, columns, oneBatch(rows));
  }

  /**
   * `insertRows` for a seed too big to hold: the batches arrive one after the other (read from a file) and
   * all go in the same transaction.
   */
  async insertRowBatches(table: string, columns: string[], batches: AsyncIterable<RowValue[][]>): Promise<number> {
    const statement = this.db.prepare(
      `INSERT INTO ${q(table, "sqlite")} (${columns.map((c) => q(c, "sqlite")).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    );
    // better-sqlite3 transactions are synchronous: begin and commit by hand around the awaited batches.
    let total = 0;
    this.db.exec("BEGIN");
    try {
      for await (const rows of batches) {
        for (const row of rows) statement.run(...row);
        total += rows.length;
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return total;
  }

  /**
   * Runs one `SELECT` and returns its rows as arrays, values as close to what
   * the engine stores as the client library allows — the reader behind logical
   * backups. Integers come back as `bigint` so a 64-bit value is not rounded.
   */
  async queryRows(sql: string): Promise<unknown[][]> {
    return this.db.prepare(sql).safeIntegers().raw().all() as unknown[][];
  }

  async executeMigration(sql: string): Promise<MigrationExecutionResult> {
    try {
      // The generated SQL already embeds its own BEGIN/COMMIT (see
      // `migrationGenerator.ts`); SQLite DDL is transactional, so a failure
      // partway through leaves an open transaction on this connection rather
      // than an auto-rollback. `db.exec` throwing doesn't clean that up by
      // itself — an explicit ROLLBACK in the catch below does.
      this.db.exec(sql);
      return {
        success: true,
        executedStatements: sql.split(";").filter((s) => s.trim().length > 0).length,
      };
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // Nothing to roll back (the failure happened before BEGIN ever ran) — fine.
      }
      return {
        success: false,
        executedStatements: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
