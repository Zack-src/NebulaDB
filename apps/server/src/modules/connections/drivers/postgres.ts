import pg from "pg";
import type { DatabaseConnectionConfig, Project, Ref, SchemaRisk, Table, TableIndex } from "@athanordb/shared";
import type { MigrationDiff } from "@athanordb/dbml-engine";
import type { DatabaseDriver, MigrationExecutionResult, TestConnectionResult } from "./interface.js";

const { Pool } = pg;

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

export class PostgresDriver implements DatabaseDriver {
  private pool: pg.Pool;

  constructor(config: DatabaseConnectionConfig) {
    if (config.connectionString) {
      this.pool = new Pool({
        connectionString: config.connectionString,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 5000,
      });
    } else {
      this.pool = new Pool({
        host: config.host || "localhost",
        port: config.port || 5432,
        database: config.database || "postgres",
        user: config.user || "postgres",
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 5000,
      });
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const res = await this.pool.query("SELECT version(), current_database() AS db;");
      const row = res.rows[0];
      return {
        ok: true,
        version: row?.version?.split(" ")?.slice(0, 2)?.join(" "),
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
    const client = await this.pool.connect();
    try {
      // 1. Fetch tables
      const tablesRes = await client.query(`
        SELECT table_name, table_schema
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);

      // 2. Fetch columns
      const columnsRes = await client.query<ColumnRow>(`
        SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_name, ordinal_position;
      `);

      // 3. Fetch Primary Keys
      const pkRes = await client.query(`
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');
      `);

      const pkMap = new Set(pkRes.rows.map((r) => `${r.table_name}.${r.column_name}`));

      // 4. Fetch Foreign Keys
      const fkRes = await client.query(`
        SELECT
          tc.constraint_name,
          tc.table_name AS from_table,
          kcu.column_name AS from_column,
          ccu.table_name AS to_table,
          ccu.column_name AS to_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');
      `);

      // Build tables & fields
      const columnsByTable = new Map<string, ColumnRow[]>();
      for (const col of columnsRes.rows) {
        if (!columnsByTable.has(col.table_name)) columnsByTable.set(col.table_name, []);
        columnsByTable.get(col.table_name)!.push(col);
      }

      const tables: Table[] = tablesRes.rows.map((t, idx) => {
        const rawCols = columnsByTable.get(t.table_name) || [];
        const fields = rawCols.map((c) => {
          const isPk = pkMap.has(`${t.table_name}.${c.column_name}`);
          const type = c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type;
          return {
            id: `${t.table_name}.${c.column_name}`,
            name: c.column_name,
            type,
            pk: isPk,
            notNull: c.is_nullable === "NO",
            default: c.column_default ? String(c.column_default) : undefined,
          };
        });

        return {
          id: t.table_name,
          name: t.table_name,
          schemaName: t.table_schema !== "public" ? t.table_schema : undefined,
          fields,
          indexes: [] as TableIndex[],
          position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
          detailLevel: "standard" as const,
        };
      });

      const refs: Ref[] = fkRes.rows.map((fk, idx) => ({
        id: `fk-${idx}-${fk.constraint_name}`,
        name: fk.constraint_name,
        from: {
          tableId: fk.from_table,
          fieldId: `${fk.from_table}.${fk.from_column}`,
        },
        to: {
          tableId: fk.to_table,
          fieldId: `${fk.to_table}.${fk.to_column}`,
        },
        cardinality: "one-to-many" as const,
      }));

      return {
        id: "live-pg-project",
        name: "PostgreSQL Live",
        tables,
        refs,
        enums: [],
        zones: [],
        stickyNotes: [],
        tableGroups: [],
      };
    } finally {
      client.release();
    }
  }

  async inspectRisks(diff: MigrationDiff): Promise<SchemaRisk[]> {
    const risks: SchemaRisk[] = [];
    const client = await this.pool.connect();

    try {
      // 1. Dropped tables
      for (const t of diff.tables.filter((t) => t.status === "dropped")) {
        try {
          const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM "${t.name}"`);
          const count = countRes.rows[0]?.count ?? 0;
          if (count > 0) {
            const sampleRes = await client.query(`SELECT * FROM "${t.name}" LIMIT 5`);
            risks.push({
              id: `risk-table-drop-${t.name}`,
              type: "DROP_TABLE_WITH_DATA",
              severity: "critical",
              tableName: t.name,
              affectedRowCount: count,
              sampleData: sampleRes.rows,
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
          // table might not exist
        }
      }

      // 2. Modified tables
      for (const t of diff.tables.filter((t) => t.status === "modified")) {
        // Dropped columns
        for (const f of t.fields.filter((f) => f.status === "dropped")) {
          try {
            const countRes = await client.query(
              `SELECT COUNT(*)::int AS count FROM "${t.name}" WHERE "${f.name}" IS NOT NULL`,
            );
            const count = countRes.rows[0]?.count ?? 0;
            if (count > 0) {
              const sampleRes = await client.query(
                `SELECT "${f.name}" AS val FROM "${t.name}" WHERE "${f.name}" IS NOT NULL LIMIT 5`,
              );
              risks.push({
                id: `risk-col-drop-${t.name}-${f.name}`,
                type: "DROP_COLUMN_WITH_DATA",
                severity: "critical",
                tableName: t.name,
                columnName: f.name,
                affectedRowCount: count,
                sampleData: sampleRes.rows.map((r) => r.val),
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
            // column might not exist
          }
        }

        // Altered type
        for (const f of t.fields.filter((f) => f.status === "modified" && f.typeChanged)) {
          try {
            const countRes = await client.query(
              `SELECT COUNT(*)::int AS count FROM "${t.name}" WHERE "${f.name}" IS NOT NULL`,
            );
            const count = countRes.rows[0]?.count ?? 0;
            if (count > 0) {
              const sampleRes = await client.query(
                `SELECT "${f.name}" AS val FROM "${t.name}" WHERE "${f.name}" IS NOT NULL LIMIT 5`,
              );
              risks.push({
                id: `risk-col-type-${t.name}-${f.name}`,
                type: "ALTER_COLUMN_TYPE",
                severity: "warning",
                tableName: t.name,
                columnName: f.name,
                affectedRowCount: count,
                sampleData: sampleRes.rows.map((r) => r.val),
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

        // Nullable -> NOT NULL
        for (const f of t.fields.filter((f) => f.status === "modified" && f.notNullChanged && f.after?.notNull)) {
          try {
            const countRes = await client.query(
              `SELECT COUNT(*)::int AS count FROM "${t.name}" WHERE "${f.name}" IS NULL`,
            );
            const count = countRes.rows[0]?.count ?? 0;
            if (count > 0) {
              risks.push({
                id: `risk-col-null-${t.name}-${f.name}`,
                type: "NULL_TO_NOT_NULL",
                severity: "critical",
                tableName: t.name,
                columnName: f.name,
                affectedRowCount: count,
                availableStrategies: [
                  {
                    key: "BACKFILL_DEFAULT",
                    labelKey: "connections.strategy.backfillDefault",
                    descriptionKey: "connections.strategy.backfillDefaultDesc",
                    requiresInput: "default_value",
                  },
                  {
                    key: "DELETE_OFFENDING_ROWS",
                    labelKey: "connections.strategy.deleteRows",
                    descriptionKey: "connections.strategy.deleteRowsDesc",
                  },
                  {
                    key: "CANCEL",
                    labelKey: "connections.strategy.cancel",
                    descriptionKey: "connections.strategy.cancelDesc",
                  },
                ],
                defaultStrategy: "BACKFILL_DEFAULT",
                selectedStrategy: "BACKFILL_DEFAULT",
                userProvidedValue: f.after?.default || "",
              });
            }
          } catch {
            // ignore
          }
        }
      }

      return risks;
    } finally {
      client.release();
    }
  }

  async executeMigration(sql: string): Promise<MigrationExecutionResult> {
    const client = await this.pool.connect();
    try {
      // The generated SQL already embeds its own BEGIN/COMMIT (see
      // `migrationGenerator.ts`) — Postgres DDL is transactional, so a
      // failure partway through leaves the session in an aborted-transaction
      // state rather than auto-rolling back. `close()` right after (every
      // call site's `finally`) ends the whole pool regardless, but this
      // client is briefly `release()`d back to it first — an explicit
      // ROLLBACK is the difference between "released clean" and "released
      // poisoned" in that window.
      await client.query(sql);
      return {
        success: true,
        executedStatements: sql.split(";").filter((s) => s.trim().length > 0).length,
      };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Nothing to roll back (the failure happened before BEGIN ever ran) — fine.
      }
      return {
        success: false,
        executedStatements: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
