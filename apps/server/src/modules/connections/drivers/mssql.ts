import net from "node:net";
import { q } from "@nebuladb/dbml-engine";
import sql from "mssql";
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
import { CONNECT_TIMEOUT_MS } from "../../../shared/sqlQuoting.js";
import { driverTlsOptions } from "./tls.js";

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
}

interface IndexRow {
  TABLE_NAME: string;
  INDEX_NAME: string;
  COLUMN_NAME: string;
  IS_UNIQUE: boolean;
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
  const tls = driverTlsOptions(config);
  const options: Record<string, unknown> = {
    encrypt: Boolean(tls),
    trustServerCertificate: !tls?.rejectUnauthorized,
  };
  if (tls) options.cryptoCredentialsDetails = { ca: tls.ca, cert: tls.cert, key: tls.key };
  if (config.pinnedAddress) options.connector = pinnedConnector(config.pinnedAddress, port);
  return {
    server: config.tlsHost || config.host || "localhost",
    port,
    database: database || config.database || "master",
    user: config.user || "sa",
    password: config.password,
    options,
    connectionTimeout: CONNECT_TIMEOUT_MS,
  };
}

/** Same shape as `PostgresDriver`/`MysqlDriver` (statement-by-statement execution); targets SQL Server via `mssql` (tedious). */
export class MssqlDriver implements DatabaseDriver {
  private pool: sql.ConnectionPool;
  private ready: Promise<sql.ConnectionPool>;

  constructor(config: DriverConnectionConfig) {
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

    // The indexes created on their own: a primary key and a UNIQUE constraint are already read as the column's `pk` / `unique`.
    const indexRes = await pool.request().query<IndexRow>(
      `SELECT t.name AS TABLE_NAME, i.name AS INDEX_NAME, c.name AS COLUMN_NAME, i.is_unique AS IS_UNIQUE
       FROM sys.indexes i
       JOIN sys.tables t ON t.object_id = i.object_id
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.type > 0 AND i.is_primary_key = 0 AND i.is_unique_constraint = 0 AND i.is_hypothetical = 0
       ORDER BY t.name, i.name, ic.key_ordinal`,
    );
    // A UNIQUE constraint on one column is that column's `unique` (the generator writes it inline).
    const uniqueRes = await pool.request().query<{ TABLE_NAME: string; COLUMN_NAME: string }>(
      `SELECT t.name AS TABLE_NAME, MIN(c.name) AS COLUMN_NAME
       FROM sys.indexes i
       JOIN sys.tables t ON t.object_id = i.object_id
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.is_unique_constraint = 1
       GROUP BY t.name, i.index_id HAVING COUNT(*) = 1`,
    );
    const uniqueSet = new Set(uniqueRes.recordset.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
    const indexesByTable = new Map<string, Map<string, TableIndex>>();
    for (const row of indexRes.recordset) {
      const byName = indexesByTable.get(row.TABLE_NAME) ?? new Map<string, TableIndex>();
      const index = byName.get(row.INDEX_NAME) ?? {
        id: `${row.TABLE_NAME}.${row.INDEX_NAME}`,
        name: row.INDEX_NAME,
        fieldIds: [],
        ...(row.IS_UNIQUE ? { unique: true } : {}),
      };
      index.fieldIds.push(`${row.TABLE_NAME}.${row.COLUMN_NAME}`);
      byName.set(row.INDEX_NAME, index);
      indexesByTable.set(row.TABLE_NAME, byName);
    }

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
        ...(uniqueSet.has(`${t.TABLE_NAME}.${c.COLUMN_NAME}`) ? { unique: true } : {}),
        notNull: c.IS_NULLABLE === "NO",
        default: c.COLUMN_DEFAULT !== null ? String(c.COLUMN_DEFAULT) : undefined,
      }));

      return {
        id: t.TABLE_NAME,
        name: t.TABLE_NAME,
        fields,
        indexes: [...(indexesByTable.get(t.TABLE_NAME)?.values() ?? [])],
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
   *
   * Rows that carry the value of an identity column (a seed or a backup keeps
   * its ids so that the foreign keys of the other tables still match) are
   * inserted under `IDENTITY_INSERT`, which SQL Server requires for them. The
   * option is set inside each parameterized batch: it ends with the batch, so
   * nothing stays on the pooled connection, even when the insert fails.
   */
  async insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number> {
    return this.insertRowBatches(table, columns, oneBatch(rows));
  }

  /**
   * `insertRows` for a seed too big to hold: the batches arrive one after the other (read from a file) and
   * all go in the same transaction.
   */
  async insertRowBatches(table: string, columns: string[], batches: AsyncIterable<RowValue[][]>): Promise<number> {
    const pool = await this.ready;
    const target = q(table, "mssql");
    const identity = await pool
      .request()
      .input("table", sql.NVarChar(sql.MAX), target)
      .query<{ name: string }>("SELECT name FROM sys.identity_columns WHERE object_id = OBJECT_ID(@table)");
    const identityColumns = new Set(identity.recordset.map((row) => row.name.toLowerCase()));
    const keepsIdentity = columns.some((column) => identityColumns.has(column.toLowerCase()));
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      let total = 0;
      for await (const rows of batches) total += await insertChunks(transaction, table, columns, rows, keepsIdentity);
      await transaction.commit();
      return total;
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
   * Statement by statement, each its own batch (a `CREATE VIEW` or a
   * `CREATE TRIGGER` has to be the first of its batch), all inside one real
   * transaction opened by the driver: the script's own `BEGIN TRANSACTION` /
   * `COMMIT` are left out, since sent as separate batches they would neither
   * hold the statements together nor roll anything back — a failure used to
   * leave the tables created before it in place. DDL is transactional in SQL
   * Server, so a failure now undoes the whole script and `executedStatements`
   * is 0, as on PostgreSQL. What SQL Server refuses inside a transaction (see
   * `mssqlMigrationSteps`) runs on its own between two transactions; only what
   * came after it is undone then. The error still names the statement by its
   * position in the script ("statement N of M failed").
   */
  async executeMigration(sql_: string): Promise<MigrationExecutionResult> {
    const pool = await this.ready;
    const steps = mssqlMigrationSteps(sql_);

    let committed = 0;
    let pending = 0;
    let transaction: sql.Transaction | null = null;
    /** Position of the statement running, or `null` while committing. */
    let running: number | null = null;
    const commit = async () => {
      if (!transaction) return;
      running = null;
      await transaction.commit();
      transaction = null;
      committed += pending;
      pending = 0;
    };
    try {
      for (const [index, step] of steps.entries()) {
        if (step.outsideTransaction) {
          await commit();
          running = index;
          await pool.request().query(step.statement);
          committed++;
          continue;
        }
        if (!transaction) {
          transaction = new sql.Transaction(pool);
          await transaction.begin();
        }
        running = index;
        await new sql.Request(transaction).query(step.statement);
        pending++;
      }
      await commit();
      return { success: true, executedStatements: committed };
    } catch (err) {
      // Already gone when SQL Server aborted it on its own: nothing more to undo.
      if (transaction) await (transaction as sql.Transaction).rollback().catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        executedStatements: committed,
        error:
          running === null
            ? `the transaction could not be committed: ${message}`
            : `statement ${running + 1} of ${steps.length} failed: ${message}`,
      };
    }
  }

  /**
   * A restore in one transaction: SQL Server rolls back the `DELETE`s and the
   * inserts together. Identity values go in under `IDENTITY_INSERT` (see
   * `insertRowBatches`), and the identity then follows on its own: an explicit
   * value above the current one becomes the current one, so no `DBCC
   * CHECKIDENT` — which needs more rights than the inserts — is run.
   */
  async openRestoreSession(): Promise<RestoreSession> {
    const pool = await this.ready;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    const identityOf = new Map<string, Set<string>>();
    let finished = false;
    return {
      atomic: true,
      identities: "automatic",
      async describeTable(table) {
        // Computed columns, `rowversion` (system type `timestamp`) and the period columns of a temporal table are all written by the server.
        const result = await new sql.Request(transaction)
          .input("table", sql.NVarChar(sql.MAX), q(table, "mssql"))
          .query<{ name: string; is_identity: boolean; generated: number }>(
            `SELECT c.name, c.is_identity,
                    CASE WHEN c.is_computed = 1 OR TYPE_NAME(c.system_type_id) = 'timestamp'
                           OR ISNULL(COLUMNPROPERTY(c.object_id, c.name, 'GeneratedAlwaysType'), 0) <> 0
                         THEN 1 ELSE 0 END AS generated
             FROM sys.columns c WHERE c.object_id = OBJECT_ID(@table)`,
          );
        const identity = result.recordset.filter((row) => row.is_identity).map((row) => row.name);
        identityOf.set(table, new Set(identity.map((name) => name.toLowerCase())));
        return {
          generated: result.recordset.filter((row) => row.generated === 1).map((row) => row.name),
          identity,
        };
      },
      async emptyTable(table) {
        const result = await new sql.Request(transaction).query(`DELETE FROM ${q(table, "mssql")}`);
        return result.rowsAffected[0] ?? 0;
      },
      async insertRows(table, columns, rows) {
        const identity = identityOf.get(table);
        const keepsIdentity = columns.some((column) => identity?.has(column.toLowerCase()));
        return insertChunks(transaction, table, columns, rows, keepsIdentity);
      },
      async resyncIdentity() {},
      async commit() {
        await transaction.commit();
        finished = true;
      },
      async rollback() {
        if (!finished) await transaction.rollback().catch(() => {});
        finished = true;
      },
      async release() {},
    };
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}

/**
 * One table's rows as multi-row `INSERT`s with bound parameters, inside
 * `transaction`. `keepsIdentity`: the rows carry the identity column's
 * values, which SQL Server only takes under `IDENTITY_INSERT`. The option is
 * set inside each parameterized batch: it ends with the batch, so nothing
 * stays on the pooled connection, even when the insert fails.
 */
async function insertChunks(
  transaction: sql.Transaction,
  table: string,
  columns: string[],
  rows: RowValue[][],
  keepsIdentity: boolean,
): Promise<number> {
  const target = q(table, "mssql");
  // SQL Server caps a statement at 2100 parameters and a VALUES list at 1000 rows.
  const batch = Math.max(1, Math.min(1000, Math.floor(2000 / columns.length)));
  const insert = `INSERT INTO ${target} (${columns.map((c) => q(c, "mssql")).join(", ")}) VALUES `;
  const head = keepsIdentity ? `SET IDENTITY_INSERT ${target} ON; ${insert}` : insert;
  const tail = keepsIdentity ? `; SET IDENTITY_INSERT ${target} OFF` : "";
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
              request.input(name, value instanceof Uint8Array ? sql.VarBinary(sql.MAX) : sql.NVarChar(sql.MAX), value);
              return `@${name}`;
            })
            .join(", ")})`,
      )
      .join(", ");
    await request.query(head + values + tail);
  }
  return rows.length;
}

/** What SQL Server refuses to run inside a user transaction. */
const OUTSIDE_TRANSACTION =
  /^(?:(?:CREATE|ALTER|DROP)\s+(?:DATABASE|FULLTEXT\s+(?:INDEX|CATALOG))|BACKUP|RESTORE|RECONFIGURE)\b/i;

/** A statement without the comment lines in front of it (the warnings a rollback script starts with). */
function withoutLeadingComments(statement: string): string {
  return statement.replace(/^(?:\s*--[^\n]*(?:\n|$))+/, "").trim();
}

/**
 * The statements of a migration script as `executeMigration` runs them: split
 * on `;`, without the script's own `BEGIN TRANSACTION` / `COMMIT` (the driver
 * opens a real transaction instead) or what is only comments, each marked when
 * it has to run outside a transaction (`CREATE DATABASE`, a full-text index…).
 */
export function mssqlMigrationSteps(sql_: string): { statement: string; outsideTransaction: boolean }[] {
  return sql_
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => {
      const bare = withoutLeadingComments(statement);
      return bare.length > 0 && !/^(BEGIN(\s+TRAN(SACTION)?)?|COMMIT(\s+TRAN(SACTION)?)?)$/i.test(bare);
    })
    .map((statement) => ({
      statement,
      outsideTransaction: OUTSIDE_TRANSACTION.test(withoutLeadingComments(statement)),
    }));
}
