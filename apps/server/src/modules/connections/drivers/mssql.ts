import sql from "mssql";
import type { DatabaseConnectionConfig, Project, Ref, SchemaRisk, Table, TableIndex } from "@athanordb/shared";
import type { MigrationDiff } from "@athanordb/dbml-engine";
import type { DatabaseDriver, MigrationExecutionResult, TestConnectionResult } from "./interface.js";

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

/**
 * Same shape as `PostgresDriver`/`MysqlDriver` (see those for the reasoning
 * behind the risk-inspection and statement-by-statement execution patterns);
 * this one targets SQL Server via `mssql` (tedious). `bracketAll` mirrors
 * `q()` in `migrationGenerator.ts` — kept local rather than imported so this
 * driver has no compile-time dependency on dbml-engine's internal helper.
 */
function bracket(ident: string): string {
  return `[${ident.replace(/]/g, "]]")}]`;
}

export class MssqlDriver implements DatabaseDriver {
  private pool: sql.ConnectionPool;
  private ready: Promise<sql.ConnectionPool>;
  private databaseName: string;

  constructor(config: DatabaseConnectionConfig) {
    this.databaseName = config.database || "master";
    const poolConfig: sql.config = config.connectionString
      ? ({ connectionString: config.connectionString } as unknown as sql.config)
      : {
          server: config.host || "localhost",
          port: config.port || 1433,
          database: this.databaseName,
          user: config.user || "sa",
          password: config.password,
          options: {
            encrypt: Boolean(config.ssl),
            trustServerCertificate: !config.ssl,
          },
          connectionTimeout: 5000,
        };
    this.pool = new sql.ConnectionPool(poolConfig);
    this.ready = this.pool.connect();
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const pool = await this.ready;
      const result = await pool.request().query<{ version: string; db: string }>(
        "SELECT @@VERSION AS version, DB_NAME() AS db",
      );
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

  async inspectRisks(diff: MigrationDiff): Promise<SchemaRisk[]> {
    const risks: SchemaRisk[] = [];
    const pool = await this.ready;

    for (const t of diff.tables.filter((t) => t.status === "dropped")) {
      try {
        const countRes = await pool.request().query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${bracket(t.name)}`);
        const count = countRes.recordset[0]?.c ?? 0;
        if (count > 0) {
          const sampleRes = await pool.request().query(`SELECT TOP 5 * FROM ${bracket(t.name)}`);
          risks.push({
            id: `risk-table-drop-${t.name}`,
            type: "DROP_TABLE_WITH_DATA",
            severity: "critical",
            tableName: t.name,
            affectedRowCount: count,
            sampleData: sampleRes.recordset,
            availableStrategies: [
              { key: "DROP_DATA_CONFIRMED", labelKey: "connections.strategy.dropData", descriptionKey: "connections.strategy.dropDataDesc" },
              { key: "KEEP_IN_DB", labelKey: "connections.strategy.keepInDb", descriptionKey: "connections.strategy.keepInDbDesc" },
              { key: "CANCEL", labelKey: "connections.strategy.cancel", descriptionKey: "connections.strategy.cancelDesc" },
            ],
            defaultStrategy: "KEEP_IN_DB",
            selectedStrategy: "KEEP_IN_DB",
          });
        }
      } catch {
        // table might not exist
      }
    }

    return risks;
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
