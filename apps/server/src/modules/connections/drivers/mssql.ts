import net from "node:net";
import { q } from "@athanordb/dbml-engine";
import sql from "mssql";
import type { Project, Ref, Table, TableIndex } from "@athanordb/shared";
import type {
  DatabaseDriver,
  DriverConnectionConfig,
  MigrationExecutionResult,
  RowValue,
  TestConnectionResult,
} from "./interface.js";

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
}

interface ForeignKeyRow {
  CONSTRAINT_NAME: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

/** Opens the socket to the pinned address while `server` stays the real name, which TLS and the login packet still need. */
function pinnedConnector(address: string, port: number): () => Promise<net.Socket> {
  return () =>
    new Promise((resolve, reject) => {
      const socket = net.connect({ host: address, port });
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
}

/** Shared with the admin driver (`admin/mssql.ts`). */
export function mssqlPoolConfig(config: DriverConnectionConfig, database?: string): sql.config {
  if (config.connectionString) {
    return { connectionString: config.connectionString, ...(database ? { database } : {}) } as unknown as sql.config;
  }
  const port = config.port || 1433;
  const options: Record<string, unknown> = {
    encrypt: Boolean(config.ssl),
    trustServerCertificate: !config.ssl,
  };
  if (config.pinnedAddress) options.connector = pinnedConnector(config.pinnedAddress, port);
  return {
    server: config.host || "localhost",
    port,
    database: database || config.database || "master",
    user: config.user || "sa",
    password: config.password,
    options,
    connectionTimeout: 5000,
  };
}

/** Same shape as `PostgresDriver`/`MysqlDriver` (statement-by-statement execution); targets SQL Server via `mssql` (tedious). */
export class MssqlDriver implements DatabaseDriver {
  private pool: sql.ConnectionPool;
  private ready: Promise<sql.ConnectionPool>;
  private databaseName: string;

  constructor(config: DriverConnectionConfig) {
    this.databaseName = config.database || "master";
    this.pool = new sql.ConnectionPool(mssqlPoolConfig(config));
    this.ready = this.pool.connect();
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const pool = await this.ready;
      const result = await pool
        .request()
        .query<{ version: string; db: string }>("SELECT @@VERSION AS version, DB_NAME() AS db");
      const row = result.recordset[0];
      return {
        ok: true,
        version: row?.version?.split("\n")[0],
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
    const pool = await this.ready;

    const tablesRes = await pool
      .request()
      .query<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      );

    const columnsRes = await pool.request().query<ColumnRow>(
      `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS c
       ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    );

    const pkRes = await pool.request().query<{ TABLE_NAME: string; COLUMN_NAME: string }>(
      `SELECT tc.TABLE_NAME, kcu.COLUMN_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`,
    );
    const pkSet = new Set(pkRes.recordset.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));

    const fkRes = await pool.request().query<ForeignKeyRow>(
      `SELECT
         fk.name AS CONSTRAINT_NAME,
         tp.name AS TABLE_NAME,
         cp.name AS COLUMN_NAME,
         tr.name AS REFERENCED_TABLE_NAME,
         cr.name AS REFERENCED_COLUMN_NAME
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.tables tp ON tp.object_id = fkc.parent_object_id
       JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
       JOIN sys.tables tr ON tr.object_id = fkc.referenced_object_id
       JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id`,
    );

    const columnsByTable = new Map<string, ColumnRow[]>();
    for (const col of columnsRes.recordset) {
      if (!columnsByTable.has(col.TABLE_NAME)) columnsByTable.set(col.TABLE_NAME, []);
      columnsByTable.get(col.TABLE_NAME)!.push(col);
    }

    const tables: Table[] = tablesRes.recordset.map((t, idx) => {
      const rawCols = columnsByTable.get(t.TABLE_NAME) || [];
      const fields = rawCols.map((c) => ({
        id: `${t.TABLE_NAME}.${c.COLUMN_NAME}`,
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        pk: pkSet.has(`${t.TABLE_NAME}.${c.COLUMN_NAME}`),
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

    const refs: Ref[] = fkRes.recordset.map((fk, idx) => ({
      id: `fk-${idx}-${fk.CONSTRAINT_NAME}`,
      name: fk.CONSTRAINT_NAME,
      from: { tableId: fk.TABLE_NAME, fieldId: `${fk.TABLE_NAME}.${fk.COLUMN_NAME}` },
      to: { tableId: fk.REFERENCED_TABLE_NAME, fieldId: `${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}` },
      cardinality: "one-to-many" as const,
    }));

    return {
      id: "live-mssql-project",
      name: "SQL Server Live",
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
  async queryScalar(sql_: string): Promise<number | null> {
    const pool = await this.ready;
    const res = await pool.request().query(sql_);
    const row = res.recordset[0] as Record<string, unknown> | undefined;
    const value = row ? Object.values(row)[0] : undefined;
    return value === null || value === undefined ? null : Number(value);
  }

  /**
   * Inserts seed rows in one transaction, in batches, with bound parameters —
   * never values spliced into the SQL. All or nothing: a failing row rolls the
   * whole table back. Returns the number of rows inserted.
   */
  async insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number> {
    if (rows.length === 0) return 0;
    const pool = await this.ready;
    const transaction = new sql.Transaction(pool);
    // SQL Server caps a statement at 2100 parameters and a VALUES list at 1000 rows.
    const batch = Math.max(1, Math.min(1000, Math.floor(2000 / columns.length)));
    const head = `INSERT INTO ${q(table, "mssql")} (${columns.map((c) => q(c, "mssql")).join(", ")}) VALUES `;
    await transaction.begin();
    try {
      for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        const request = new sql.Request(transaction);
        let n = 0;
        const values = chunk
          .map(
            (row) =>
              `(${row
                .map((value) => {
                  const name = `p${n++}`;
                  request.input(
                    name,
                    value instanceof Uint8Array ? sql.VarBinary(sql.MAX) : sql.NVarChar(sql.MAX),
                    value,
                  );
                  return `@${name}`;
                })
                .join(", ")})`,
          )
          .join(", ");
        await request.query(head + values);
      }
      await transaction.commit();
      return rows.length;
    } catch (err) {
      await transaction.rollback().catch(() => {});
      throw err;
    }
  }

  /**
   * Runs one `SELECT` and returns its rows as arrays, values as close to what
   * the engine stores as the client library allows — the reader behind logical
   * backups. Dates come back as JavaScript dates (UTC), binary columns as buffers.
   */
  async queryRows(sql_: string): Promise<unknown[][]> {
    const pool = await this.ready;
    const request = pool.request();
    request.arrayRowMode = true;
    const res = await request.query(sql_);
    return res.recordset as unknown as unknown[][];
  }

  /**
   * Statement-by-statement like `MysqlDriver` (SQL Server DDL is transactional
   * so a wrapping transaction would work here, but per-statement execution
   * keeps `executedStatements` exact on partial failure the same way).
   */
  async executeMigration(sql_: string): Promise<MigrationExecutionResult> {
    const pool = await this.ready;
    const statements = sql_
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.toUpperCase() !== "BEGIN TRANSACTION" && s.toUpperCase() !== "COMMIT");

    let executed = 0;
    for (const statement of statements) {
      try {
        await pool.request().query(statement);
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
    await this.pool.close();
  }
}
