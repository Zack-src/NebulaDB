import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { Project, Ref, Table, TableIndex } from "@athanordb/shared";
import type {
  DatabaseDriver,
  DriverConnectionConfig,
  MigrationExecutionResult,
  TestConnectionResult,
} from "./interface.js";

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

interface ForeignKeyRow extends RowDataPacket {
  CONSTRAINT_NAME: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

/** Shared with the admin driver (`admin/mysql.ts`). */
export function mysqlPoolConfig(config: DriverConnectionConfig, database?: string): mysql.PoolOptions {
  if (config.connectionString) {
    return {
      uri: config.connectionString,
      waitForConnections: true,
      connectionLimit: 5,
      ...(database ? { database } : {}),
    };
  }
  return {
    host: config.pinnedAddress || config.host || "localhost",
    port: config.port || 3306,
    database: database || config.database || "mysql",
    user: config.user || "root",
    password: config.password,
    waitForConnections: true,
    connectionLimit: 5,
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
        notNull: c.IS_NULLABLE === "NO",
        default: c.COLUMN_DEFAULT !== null ? String(c.COLUMN_DEFAULT) : undefined,
      }));

      return {
        id: t.TABLE_NAME,
        name: t.TABLE_NAME,
        fields,
        indexes: [] as TableIndex[],
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
   * Unlike the Postgres/SQLite drivers, there is deliberately no catch-block
   * ROLLBACK here: MySQL's DDL statements each cause an implicit commit
   * regardless of the `START TRANSACTION`/`COMMIT` the generated SQL wraps
   * them in (see `migrationGenerator.ts`), so a failure partway through has
   * already permanently applied everything before it — a ROLLBACK at that
   * point would roll back nothing and imply a safety this call can't
   * actually provide.
   *
   * Executed **statement by statement** rather than as one multi-statement
   * blob (the previous shape, which needed `multipleStatements: true` on the
   * pool — removed above). That change is what makes `executedStatements`
   * honest on failure: this used to always report 0 regardless of how much
   * of the batch actually landed, which was flagged in this same comment as
   * a real, unresolved gap. Now it's an exact count, and `error` names which
   * statement (1-indexed, matching what a human counting semicolons in the
   * SQL preview would call it) failed.
   *
   * The split itself is the same naive `split(";")` every driver already
   * uses just to *count* statements for the success path — extending it to
   * also *execute* individually inherits the same known limitation: SQL
   * containing a semicolon inside a string literal (a table/column default
   * value, say) would be split incorrectly. `migrationGenerator.ts` doesn't
   * currently produce such a default, so this isn't a change in what's
   * supported today, only a documented edge this driver doesn't yet handle.
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
