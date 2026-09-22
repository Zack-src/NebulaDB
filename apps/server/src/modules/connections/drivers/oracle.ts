import oracledb from "oracledb";
import type { DatabaseConnectionConfig, Project, Ref, SchemaRisk, Table, TableIndex } from "@athanordb/shared";
import type { MigrationDiff } from "@athanordb/dbml-engine";
import type { DatabaseDriver, MigrationExecutionResult, TestConnectionResult } from "./interface.js";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  NULLABLE: string;
  DATA_DEFAULT: string | null;
}

interface ForeignKeyRow {
  CONSTRAINT_NAME: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  R_TABLE_NAME: string;
  R_COLUMN_NAME: string;
}

/**
 * Same shape as the other network drivers (see `PostgresDriver`/`MysqlDriver`
 * for the reasoning behind risk-inspection and statement-by-statement
 * execution). Uses `oracledb`'s pure-JS "thin" mode (default since v6, no
 * Oracle Instant Client needed) via a connection pool. Oracle has no
 * information_schema — everything below reads the `USER_*` data dictionary
 * views, scoped to whatever schema the connecting user owns, mirroring how
 * the Postgres/MySQL drivers scope to one schema/database.
 */
export class OracleDriver implements DatabaseDriver {
  private pool: Promise<oracledb.Pool>;

  constructor(config: DatabaseConnectionConfig) {
    const connectString = config.connectionString || `${config.host || "localhost"}:${config.port || 1521}/${config.database || "FREEPDB1"}`;
    this.pool = oracledb.createPool({
      user: config.user || "system",
      password: config.password,
      connectString,
      poolMin: 0,
      poolMax: 5,
    });
  }

  private async getConnection(): Promise<oracledb.Connection> {
    const pool = await this.pool;
    return pool.getConnection();
  }

  async testConnection(): Promise<TestConnectionResult> {
    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.getConnection();
      const res = await conn.execute<{ VERSION: string; DB: string }>(
        `SELECT banner AS version, sys_context('USERENV','DB_NAME') AS db FROM v$version WHERE ROWNUM = 1`,
      );
      const row = res.rows?.[0] as unknown as { VERSION: string; DB: string } | undefined;
      return { ok: true, version: row?.VERSION, database: row?.DB };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await conn?.close().catch(() => {});
    }
  }

  async introspectSchema(): Promise<Project> {
    const conn = await this.getConnection();
    try {
      const tablesRes = await conn.execute<{ TABLE_NAME: string }>(
        `SELECT table_name AS "TABLE_NAME" FROM user_tables ORDER BY table_name`,
      );

      const columnsRes = await conn.execute<ColumnRow>(
        `SELECT table_name AS "TABLE_NAME", column_name AS "COLUMN_NAME", data_type AS "DATA_TYPE",
                nullable AS "NULLABLE", data_default AS "DATA_DEFAULT"
         FROM user_tab_columns
         ORDER BY table_name, column_id`,
      );

      const pkRes = await conn.execute<{ TABLE_NAME: string; COLUMN_NAME: string }>(
        `SELECT cols.table_name AS "TABLE_NAME", cols.column_name AS "COLUMN_NAME"
         FROM user_constraints cons
         JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
         WHERE cons.constraint_type = 'P'`,
      );
      const pkSet = new Set(
        (pkRes.rows ?? []).map((r) => `${(r as unknown as { TABLE_NAME: string }).TABLE_NAME}.${(r as unknown as { COLUMN_NAME: string }).COLUMN_NAME}`),
      );

      const fkRes = await conn.execute<ForeignKeyRow>(
        `SELECT a.constraint_name AS "CONSTRAINT_NAME", a.table_name AS "TABLE_NAME", a.column_name AS "COLUMN_NAME",
                c_pk.table_name AS "R_TABLE_NAME", b.column_name AS "R_COLUMN_NAME"
         FROM user_cons_columns a
         JOIN user_constraints c ON a.constraint_name = c.constraint_name
         JOIN user_constraints c_pk ON c.r_constraint_name = c_pk.constraint_name
         JOIN user_cons_columns b ON c_pk.constraint_name = b.constraint_name AND a.position = b.position
         WHERE c.constraint_type = 'R'`,
      );

      const columnsByTable = new Map<string, ColumnRow[]>();
      for (const col of (columnsRes.rows ?? []) as unknown as ColumnRow[]) {
        if (!columnsByTable.has(col.TABLE_NAME)) columnsByTable.set(col.TABLE_NAME, []);
        columnsByTable.get(col.TABLE_NAME)!.push(col);
      }

      const tables: Table[] = ((tablesRes.rows ?? []) as unknown as { TABLE_NAME: string }[]).map((t, idx) => {
        const rawCols = columnsByTable.get(t.TABLE_NAME) || [];
        const fields = rawCols.map((c) => ({
          id: `${t.TABLE_NAME}.${c.COLUMN_NAME}`,
          name: c.COLUMN_NAME,
          type: c.DATA_TYPE,
          pk: pkSet.has(`${t.TABLE_NAME}.${c.COLUMN_NAME}`),
          notNull: c.NULLABLE === "N",
          default: c.DATA_DEFAULT !== null && c.DATA_DEFAULT !== undefined ? String(c.DATA_DEFAULT).trim() : undefined,
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

      const refs: Ref[] = ((fkRes.rows ?? []) as unknown as ForeignKeyRow[]).map((fk, idx) => ({
        id: `fk-${idx}-${fk.CONSTRAINT_NAME}`,
        name: fk.CONSTRAINT_NAME,
        from: { tableId: fk.TABLE_NAME, fieldId: `${fk.TABLE_NAME}.${fk.COLUMN_NAME}` },
        to: { tableId: fk.R_TABLE_NAME, fieldId: `${fk.R_TABLE_NAME}.${fk.R_COLUMN_NAME}` },
        cardinality: "one-to-many" as const,
      }));

      return {
        id: "live-oracle-project",
        name: "Oracle Live",
        tables,
        refs,
        enums: [],
        zones: [],
        stickyNotes: [],
        tableGroups: [],
      };
    } finally {
      await conn.close().catch(() => {});
    }
  }

  async inspectRisks(diff: MigrationDiff): Promise<SchemaRisk[]> {
    const risks: SchemaRisk[] = [];
    const conn = await this.getConnection();
    try {
      for (const t of diff.tables.filter((t) => t.status === "dropped")) {
        try {
          const countRes = await conn.execute<{ C: number }>(`SELECT COUNT(*) AS "C" FROM "${t.name}"`);
          const count = (countRes.rows?.[0] as unknown as { C: number })?.C ?? 0;
          if (count > 0) {
            const sampleRes = await conn.execute(`SELECT * FROM "${t.name}" WHERE ROWNUM <= 5`);
            risks.push({
              id: `risk-table-drop-${t.name}`,
              type: "DROP_TABLE_WITH_DATA",
              severity: "critical",
              tableName: t.name,
              affectedRowCount: count,
              sampleData: (sampleRes.rows ?? []) as Record<string, unknown>[],
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
    } finally {
      await conn.close().catch(() => {});
    }
    return risks;
  }

  /**
   * Statement-by-statement, same reasoning as `MysqlDriver`/`MssqlDriver`.
   * Oracle DDL autocommits regardless, so there's no transaction to lose —
   * a mid-script failure leaves every prior statement already permanently
   * applied, same caveat as MySQL.
   */
  async executeMigration(sql: string): Promise<MigrationExecutionResult> {
    const conn = await this.getConnection();
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.toUpperCase() !== "COMMIT");

    let executed = 0;
    try {
      for (const statement of statements) {
        try {
          await conn.execute(statement, [], { autoCommit: true });
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
    } finally {
      await conn.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    const pool = await this.pool;
    await pool.close(0).catch(() => {});
  }
}
