import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { DatabaseConnectionConfig, Project, Ref, SchemaRisk, Table, TableIndex } from "@athanordb/shared";
import type { MigrationDiff } from "@athanordb/dbml-engine";
import type { DatabaseDriver, MigrationExecutionResult, TestConnectionResult } from "./interface.js";

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

interface CountRow extends RowDataPacket {
  c: number;
}

interface ValueRow extends RowDataPacket {
  val: unknown;
}

export class MysqlDriver implements DatabaseDriver {
  private pool: mysql.Pool;
  private databaseName: string;

  constructor(config: DatabaseConnectionConfig) {
    this.databaseName = config.database || "mysql";
    if (config.connectionString) {
      this.pool = mysql.createPool({
        uri: config.connectionString,
        waitForConnections: true,
        connectionLimit: 5,
        multipleStatements: true,
      });
    } else {
      this.pool = mysql.createPool({
        host: config.host || "localhost",
        port: config.port || 3306,
        database: this.databaseName,
        user: config.user || "root",
        password: config.password,
        waitForConnections: true,
        connectionLimit: 5,
        multipleStatements: true,
      });
    }
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

  async inspectRisks(diff: MigrationDiff): Promise<SchemaRisk[]> {
    const risks: SchemaRisk[] = [];

    // Dropped tables
    for (const t of diff.tables.filter((t) => t.status === "dropped")) {
      try {
        const [rows] = await this.pool.query<CountRow[]>(`SELECT COUNT(*) AS c FROM \`${t.name}\``);
        const count = Number(rows[0]?.c ?? 0);
        if (count > 0) {
          const [sampleRows] = await this.pool.query<RowDataPacket[]>(`SELECT * FROM \`${t.name}\` LIMIT 5`);
          risks.push({
            id: `risk-table-drop-${t.name}`,
            type: "DROP_TABLE_WITH_DATA",
            severity: "critical",
            tableName: t.name,
            affectedRowCount: count,
            sampleData: sampleRows,
            availableStrategies: [
              {
                key: "DROP_DATA_CONFIRMED",
                labelKey: "connections.strategy.dropData",
                descriptionKey: "connections.strategy.dropDataDesc",
              },
              {
                key: "KEEP_IN_DB",
                labelKey: "connections.strategy.keepInDb",
                descriptionKey: "connections.strategy.keepInDbDesc",
              },
              {
                key: "CANCEL",
                labelKey: "connections.strategy.cancel",
                descriptionKey: "connections.strategy.cancelDesc",
              },
            ],
            defaultStrategy: "KEEP_IN_DB",
            selectedStrategy: "KEEP_IN_DB",
          });
        }
      } catch {
        // ignore
      }
    }

    // Modified tables
    for (const t of diff.tables.filter((t) => t.status === "modified")) {
      // Dropped columns
      for (const f of t.fields.filter((f) => f.status === "dropped")) {
        try {
          const [rows] = await this.pool.query<CountRow[]>(
            `SELECT COUNT(*) AS c FROM \`${t.name}\` WHERE \`${f.name}\` IS NOT NULL`,
          );
          const count = Number(rows[0]?.c ?? 0);
          if (count > 0) {
            const [sampleRows] = await this.pool.query<ValueRow[]>(
              `SELECT \`${f.name}\` AS val FROM \`${t.name}\` WHERE \`${f.name}\` IS NOT NULL LIMIT 5`,
            );
            risks.push({
              id: `risk-col-drop-${t.name}-${f.name}`,
              type: "DROP_COLUMN_WITH_DATA",
              severity: "critical",
              tableName: t.name,
              columnName: f.name,
              affectedRowCount: count,
              sampleData: sampleRows.map((r) => r.val) as (
                string | number | boolean | Record<string, unknown> | null
              )[],
              availableStrategies: [
                {
                  key: "DROP_DATA_CONFIRMED",
                  labelKey: "connections.strategy.dropData",
                  descriptionKey: "connections.strategy.dropDataDesc",
                },
                {
                  key: "KEEP_IN_DB",
                  labelKey: "connections.strategy.keepColumn",
                  descriptionKey: "connections.strategy.keepColumnDesc",
                },
                {
                  key: "CANCEL",
                  labelKey: "connections.strategy.cancel",
                  descriptionKey: "connections.strategy.cancelDesc",
                },
              ],
              defaultStrategy: "KEEP_IN_DB",
              selectedStrategy: "KEEP_IN_DB",
            });
          }
        } catch {
          // ignore
        }
      }

      // Altered type
      for (const f of t.fields.filter((f) => f.status === "modified" && f.typeChanged)) {
        try {
          const [rows] = await this.pool.query<CountRow[]>(
            `SELECT COUNT(*) AS c FROM \`${t.name}\` WHERE \`${f.name}\` IS NOT NULL`,
          );
          const count = Number(rows[0]?.c ?? 0);
          if (count > 0) {
            const [sampleRows] = await this.pool.query<ValueRow[]>(
              `SELECT \`${f.name}\` AS val FROM \`${t.name}\` WHERE \`${f.name}\` IS NOT NULL LIMIT 5`,
            );
            risks.push({
              id: `risk-col-type-${t.name}-${f.name}`,
              type: "ALTER_COLUMN_TYPE",
              severity: "warning",
              tableName: t.name,
              columnName: f.name,
              affectedRowCount: count,
              sampleData: sampleRows.map((r) => r.val) as (
                string | number | boolean | Record<string, unknown> | null
              )[],
              availableStrategies: [
                {
                  key: "FORCE_CAST",
                  labelKey: "connections.strategy.forceCast",
                  descriptionKey: "connections.strategy.forceCastDesc",
                },
                {
                  key: "CLEAR_COLUMN_DATA",
                  labelKey: "connections.strategy.clearData",
                  descriptionKey: "connections.strategy.clearDataDesc",
                },
                {
                  key: "CANCEL",
                  labelKey: "connections.strategy.cancel",
                  descriptionKey: "connections.strategy.cancelDesc",
                },
              ],
              defaultStrategy: "FORCE_CAST",
              selectedStrategy: "FORCE_CAST",
            });
          }
        } catch {
          // ignore
        }
      }
    }

    return risks;
  }

  /**
   * Unlike the Postgres/SQLite drivers, there is deliberately no catch-block
   * ROLLBACK here: MySQL's DDL statements each cause an implicit commit
   * regardless of the `START TRANSACTION`/`COMMIT` the generated SQL wraps
   * them in (see `migrationGenerator.ts`), so a failure partway through has
   * already permanently applied everything before it — a ROLLBACK at that
   * point would roll back nothing and imply a safety this call can't
   * actually provide. `executedStatements: 0` on failure is honest about the
   * *reported* count, not the *applied* one; there is currently no way to
   * tell the caller how many of the batch actually landed before the error.
   */
  async executeMigration(sql: string): Promise<MigrationExecutionResult> {
    try {
      await this.pool.query(sql);
      return {
        success: true,
        executedStatements: sql.split(";").filter((s) => s.trim().length > 0).length,
      };
    } catch (err) {
      return {
        success: false,
        executedStatements: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
