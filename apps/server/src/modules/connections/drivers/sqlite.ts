import fs from "node:fs";
import { q } from "@nebuladb/dbml-engine";
import path from "node:path";
import Database from "better-sqlite3";
import type { DatabaseConnectionConfig, Project, Ref, Table, TableIndex } from "@nebuladb/shared";
import { config as appConfig } from "../../../config.js";
import { ApiError } from "../../../shared/errors.js";
import {
  oneBatch,
  DatabaseDriver,
  MigrationExecutionResult,
  RestoreSession,
  RowValue,
  TestConnectionResult,
} from "./interface.js";

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
      const colInfo = this.db.prepare(`PRAGMA table_info(${q(tableName, "sqlite")})`).all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];

      // The indexes created on their own ('c'): a primary key ('pk') and a UNIQUE constraint ('u') are already read as
      // the column's `pk` / `unique`. An expression index has no column name and a partial one has a `WHERE`: neither
      // can be written as columns, so they are left out.
      const indexList = this.db.prepare(`PRAGMA index_list(${q(tableName, "sqlite")})`).all() as {
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }[];
      const indexes: TableIndex[] = [];
      const uniqueColumns = new Set<string>();
      for (const idx of indexList) {
        const cols = this.db.prepare(`PRAGMA index_info(${q(idx.name, "sqlite")})`).all() as {
          seqno: number;
          name: string | null;
        }[];
        cols.sort((a, b) => a.seqno - b.seqno);
        if (idx.origin === "u" && cols.length === 1 && cols[0].name) uniqueColumns.add(cols[0].name);
        if (idx.origin !== "c" || idx.partial || cols.some((c) => c.name === null)) continue;
        indexes.push({
          id: `${tableName}.${idx.name}`,
          name: idx.name,
          fieldIds: cols.map((c) => `${tableName}.${c.name}`),
          ...(idx.unique ? { unique: true } : {}),
        });
      }

      const fields = colInfo.map((c) => ({
        id: `${tableName}.${c.name}`,
        name: c.name,
        type: c.type || "text",
        pk: c.pk > 0,
        ...(uniqueColumns.has(c.name) ? { unique: true } : {}),
        notNull: c.notnull === 1,
        default: c.dflt_value !== null ? String(c.dflt_value) : undefined,
      }));

      // Foreign keys
      const fkInfo = this.db.prepare(`PRAGMA foreign_key_list(${q(tableName, "sqlite")})`).all() as {
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
        indexes,
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

  /**
   * A restore in one transaction (`BEGIN IMMEDIATE`: the write lock is taken
   * up front rather than on the first `DELETE`). Identity needs no help: an
   * `INTEGER PRIMARY KEY` takes the explicit value as its rowid, and
   * `AUTOINCREMENT` raises `sqlite_sequence` past it on its own.
   */
  async openRestoreSession(): Promise<RestoreSession> {
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    return {
      atomic: true,
      identities: "automatic",
      async describeTable(table) {
        const columns = db.prepare(`PRAGMA table_xinfo(${q(table, "sqlite")})`).all() as {
          name: string;
          type: string;
          pk: number;
          hidden: number;
        }[];
        const pk = columns.filter((column) => column.pk > 0);
        return {
          // 2: virtual generated column, 3: stored one.
          generated: columns.filter((column) => column.hidden === 2 || column.hidden === 3).map((c) => c.name),
          identity: pk.length === 1 && pk[0].type.toUpperCase() === "INTEGER" ? [pk[0].name] : [],
        };
      },
      async emptyTable(table) {
        return db.prepare(`DELETE FROM ${q(table, "sqlite")}`).run().changes;
      },
      async insertRows(table, columns, rows) {
        const statement = db.prepare(
          `INSERT INTO ${q(table, "sqlite")} (${columns.map((c) => q(c, "sqlite")).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        );
        for (const row of rows) statement.run(...row);
        return rows.length;
      },
      async resyncIdentity() {},
      async commit() {
        db.exec("COMMIT");
      },
      async rollback() {
        if (db.inTransaction) db.exec("ROLLBACK");
      },
      async release() {},
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
