import net from "node:net";
import mysql from "mysql2/promise";
import { q } from "@nebuladb/dbml-engine";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Project, Ref, Table, TableIndex } from "@nebuladb/shared";
import {
  oneBatch,
  DatabaseDriver,
  DriverConnectionConfig,
  MigrationExecutionResult,
  RestoreSession,
  RowValue,
  TestConnectionResult,
} from "./interface.js";
import { driverTlsOptions } from "./tls.js";
import { CONNECT_TIMEOUT_MS } from "../../../shared/sqlQuoting.js";

interface VersionRow extends RowDataPacket {
  version: string;
  db: string;
}

interface TableNameRow extends RowDataPacket {
  TABLE_NAME: string;
}

interface ColumnRow extends RowDataPacket {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  COLUMN_KEY: string;
}

interface IndexRow extends RowDataPacket {
  TABLE_NAME: string;
  INDEX_NAME: string;
  COLUMN_NAME: string;
  NON_UNIQUE: number;
}

interface ForeignKeyRow extends RowDataPacket {
  CONSTRAINT_NAME: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

/**
 * mysql2 checks the server's certificate against `host`, so `host` stays the
 * name the user typed and the socket is opened to the pinned address (or the
 * tunnel's local end) through `stream`.
 */
function mysqlTls(config: DriverConnectionConfig): mysql.SslOptions | undefined {
  const tls = driverTlsOptions(config);
  if (!tls) return undefined;
  return {
    ca: tls.ca as string | undefined,
    cert: tls.cert as string | undefined,
    key: tls.key as string | undefined,
    rejectUnauthorized: tls.rejectUnauthorized,
    verifyIdentity: tls.rejectUnauthorized,
  };
}

/** Shared with the admin driver (`admin/mysql.ts`). */
export function mysqlPoolConfig(config: DriverConnectionConfig, database?: string): mysql.PoolOptions {
  const ssl = mysqlTls(config);
  if (config.connectionString) {
    return {
      uri: config.connectionString,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: CONNECT_TIMEOUT_MS,
      ...(ssl ? { ssl } : {}),
      ...(database ? { database } : {}),
    };
  }
  const port = config.port || 3306;
  const address = config.pinnedAddress;
  return {
    host: config.tlsHost || config.host || "localhost",
    ...(address ? { stream: () => net.connect(port, address) } : {}),
    ...(ssl ? { ssl } : {}),
    port,
    database: database || config.database || "mysql",
    user: config.user || "root",
    password: config.password,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: CONNECT_TIMEOUT_MS,
  };
}

export class MysqlDriver implements DatabaseDriver {
  private pool: mysql.Pool;
  private databaseName: string;

  constructor(config: DriverConnectionConfig) {
    this.databaseName = config.database || "mysql";
    // `multipleStatements` used to be needed here so `executeMigration` could
    // hand the whole generated script to the driver in one `query()` call —
    // it now runs each statement individually instead (see that method's own
    // comment for why), so this stays off: one less way a future change to
    // this driver could accidentally let a single call execute more than the
    // one statement it was given.
    this.pool = mysql.createPool(mysqlPoolConfig(config));
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const [rows] = await this.pool.query<VersionRow[]>("SELECT VERSION() AS version, DATABASE() AS db");
      const row = rows[0];
      return {
        ok: true,
        version: row?.version,
        database: row?.db,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async introspectSchema(): Promise<Project> {
    const [tablesRows] = await this.pool.query<TableNameRow[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [this.databaseName],
    );

    const [columnsRows] = await this.pool.query<ColumnRow[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [this.databaseName],
    );

    const [fkRows] = await this.pool.query<ForeignKeyRow[]>(
      `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.databaseName],
    );

    // Key columns only, in key order. A functional index part has no column name and can't be written as columns,
    // so the whole index is left out; a column prefix (`SUB_PART`) is kept as the plain column.
    const [indexRows] = await this.pool.query<IndexRow[]>(
      `SELECT s.TABLE_NAME, s.INDEX_NAME, s.COLUMN_NAME, s.NON_UNIQUE
       FROM information_schema.STATISTICS s
       WHERE s.TABLE_SCHEMA = ? AND s.INDEX_NAME <> 'PRIMARY'
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.STATISTICS f
           WHERE f.TABLE_SCHEMA = s.TABLE_SCHEMA AND f.TABLE_NAME = s.TABLE_NAME AND f.INDEX_NAME = s.INDEX_NAME
             AND f.COLUMN_NAME IS NULL)
       ORDER BY s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX`,
      [this.databaseName],
    );
    const indexColumns = new Map<string, IndexRow[]>();
    for (const row of indexRows) {
      const key = `${row.TABLE_NAME}\u0000${row.INDEX_NAME}`;
      if (!indexColumns.has(key)) indexColumns.set(key, []);
      indexColumns.get(key)!.push(row);
    }
    // MySQL makes no difference between a UNIQUE constraint and a unique index. One on a single column that carries
    // that column's name (what an inline `UNIQUE` creates) is the column's `unique`; any other is an index.
    const uniqueSet = new Set<string>();
    const indexesByTable = new Map<string, TableIndex[]>();
    for (const rows of indexColumns.values()) {
      const first = rows[0];
      const unique = first.NON_UNIQUE === 0;
      const suffix = first.INDEX_NAME.startsWith(first.COLUMN_NAME) ? first.INDEX_NAME.slice(first.COLUMN_NAME.length) : null;
      if (unique && rows.length === 1 && suffix !== null && /^(_\d+)?$/.test(suffix)) {
        uniqueSet.add(`${first.TABLE_NAME}.${first.COLUMN_NAME}`);
        continue;
      }
      const list = indexesByTable.get(first.TABLE_NAME) ?? [];
      list.push({
        id: `${first.TABLE_NAME}.${first.INDEX_NAME}`,
        name: first.INDEX_NAME,
        fieldIds: rows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`),
        ...(unique ? { unique: true } : {}),
      });
      indexesByTable.set(first.TABLE_NAME, list);
    }

    const columnsByTable = new Map<string, ColumnRow[]>();
    for (const col of columnsRows) {
      if (!columnsByTable.has(col.TABLE_NAME)) columnsByTable.set(col.TABLE_NAME, []);
      columnsByTable.get(col.TABLE_NAME)!.push(col);
    }

    const tables: Table[] = tablesRows.map((t, idx) => {
      const rawCols = columnsByTable.get(t.TABLE_NAME) || [];
      const fields = rawCols.map((c) => ({
        id: `${t.TABLE_NAME}.${c.COLUMN_NAME}`,
        name: c.COLUMN_NAME,
        type: c.COLUMN_TYPE || c.DATA_TYPE,
        pk: c.COLUMN_KEY === "PRI",
        ...(uniqueSet.has(`${t.TABLE_NAME}.${c.COLUMN_NAME}`) ? { unique: true } : {}),
        notNull: c.IS_NULLABLE === "NO",
        default: c.COLUMN_DEFAULT !== null ? String(c.COLUMN_DEFAULT) : undefined,
      }));

      return {
        id: t.TABLE_NAME,
        name: t.TABLE_NAME,
        fields,
        indexes: indexesByTable.get(t.TABLE_NAME) ?? [],
        position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
        detailLevel: "standard" as const,
      };
    });

    const refs: Ref[] = fkRows.map((fk, idx) => ({
      id: `fk-${idx}-${fk.CONSTRAINT_NAME}`,
      name: fk.CONSTRAINT_NAME,
      from: {
        tableId: fk.TABLE_NAME,
        fieldId: `${fk.TABLE_NAME}.${fk.COLUMN_NAME}`,
      },
      to: {
        tableId: fk.REFERENCED_TABLE_NAME,
        fieldId: `${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`,
      },
      cardinality: "one-to-many" as const,
    }));

    return {
      id: "live-mysql-project",
      name: "MySQL Live",
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
    const [rows] = await this.pool.query<RowDataPacket[]>({ sql, rowsAsArray: true });
    const value = (rows[0] as unknown as unknown[] | undefined)?.[0];
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
    const conn = await this.pool.getConnection();
    const head = `INSERT INTO ${q(table, "mysql")} (${columns.map((c) => q(c, "mysql")).join(", ")}) VALUES ?`;
    try {
      await conn.beginTransaction();
      let total = 0;
      for await (const rows of batches) {
        for (let i = 0; i < rows.length; i += 500) await conn.query(head, [rows.slice(i, i + 500)]);
        total += rows.length;
      }
      await conn.commit();
      return total;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Runs one `SELECT` and returns its rows as arrays, values as close to what
   * the engine stores as the client library allows — the reader behind logical
   * backups. Dates and big numbers come back as the strings MySQL prints, not as JavaScript dates or rounded numbers.
   */
  async queryRows(sql: string): Promise<unknown[][]> {
    const [rows] = await this.pool.query<RowDataPacket[]>({
      sql,
      rowsAsArray: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    return rows as unknown as unknown[][];
  }

  /**
   * No catch-block ROLLBACK, unlike Postgres/SQLite: each MySQL DDL statement implicitly
   * commits, so a failure has already applied everything before it.
   *
   * Executed statement by statement so `executedStatements` is exact and `error` names the
   * failing statement (1-indexed). The `split(";")` is naive: a semicolon inside a string
   * literal (a default value, say) would be split wrongly; `migrationGenerator.ts` produces none.
   */
  async executeMigration(sql: string): Promise<MigrationExecutionResult> {
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let executed = 0;
    for (const statement of statements) {
      try {
        await this.pool.query(statement);
        executed++;
      } catch (err) {
        return {
          success: false,
          executedStatements: executed,
          error: `statement ${executed + 1} of ${statements.length} failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return { success: true, executedStatements: executed };
  }

  /**
   * A restore on one connection: one transaction when every table is InnoDB
   * (its `DELETE`s and inserts roll back), autocommitted statement by
   * statement otherwise — a MyISAM table keeps what was done to it whatever
   * happens next, and a half-rolled-back restore would report counts that are
   * true for some tables only.
   *
   * `NO_AUTO_VALUE_ON_ZERO` for the session, so a restored `0` id stays `0`
   * instead of drawing a new value; the previous mode is put back on release.
   * The `AUTO_INCREMENT` counter needs nothing: inserting an explicit value
   * raises it past that value, and moving it down would take an `ALTER
   * TABLE`, which commits.
   */
  async openRestoreSession(tables: string[]): Promise<RestoreSession> {
    const conn = await this.pool.getConnection();
    let sqlMode: string | null = null;
    let broken = false;
    try {
      const [engines] = await conn.query<RowDataPacket[]>(
        `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
        [tables.length > 0 ? tables : [""]],
      );
      const atomic =
        engines.length >= new Set(tables).size &&
        engines.every((row) => String(row.ENGINE ?? "").toLowerCase() === "innodb");
      const [[mode]] = await conn.query<RowDataPacket[]>("SELECT @@SESSION.sql_mode AS mode");
      sqlMode = String(mode?.mode ?? "");
      await conn.query("SET SESSION sql_mode = ?", [
        [sqlMode, "NO_AUTO_VALUE_ON_ZERO"].filter((part) => part.length > 0).join(","),
      ]);
      if (atomic) await conn.beginTransaction();
      return {
        atomic,
        identities: "automatic",
        async describeTable(table) {
          const [columns] = await conn.query<RowDataPacket[]>(
            `SELECT COLUMN_NAME, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table],
          );
          const extra = (row: RowDataPacket) => String(row.EXTRA ?? "");
          return {
            // `VIRTUAL GENERATED` / `STORED GENERATED` (MariaDB: `PERSISTENT`) — not MySQL 8's `DEFAULT_GENERATED`, a plain default.
            generated: columns
              .filter((row) => /\b(VIRTUAL|STORED|PERSISTENT)\b/i.test(extra(row)))
              .map((row) => String(row.COLUMN_NAME)),
            identity: columns
              .filter((row) => /auto_increment/i.test(extra(row)))
              .map((row) => String(row.COLUMN_NAME)),
          };
        },
        async emptyTable(table) {
          const [result] = await conn.query<ResultSetHeader>(`DELETE FROM ${q(table, "mysql")}`);
          return result.affectedRows;
        },
        async insertRows(table, columns, rows) {
          const head = `INSERT INTO ${q(table, "mysql")} (${columns.map((c) => q(c, "mysql")).join(", ")}) VALUES ?`;
          for (let i = 0; i < rows.length; i += 500) await conn.query(head, [rows.slice(i, i + 500)]);
          return rows.length;
        },
        async resyncIdentity() {},
        async commit() {
          if (atomic) await conn.commit();
        },
        async rollback() {
          if (atomic) await conn.rollback().catch(() => (broken = true));
        },
        async release() {
          if (!broken) await conn.query("SET SESSION sql_mode = ?", [sqlMode]).catch(() => (broken = true));
          if (broken) conn.destroy();
          else conn.release();
        },
      };
    } catch (err) {
      conn.destroy();
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
