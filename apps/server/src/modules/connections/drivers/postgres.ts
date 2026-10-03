import pg from "pg";
import { q } from "@athanordb/dbml-engine";
import type { Project, Ref, Table, TableIndex } from "@athanordb/shared";
import type {
  DatabaseDriver,
  DriverConnectionConfig,
  MigrationExecutionResult,
  TestConnectionResult,
} from "./interface.js";

const { Pool } = pg;

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

/** Shared with the admin driver (`admin/postgres.ts`) so both connect to the same pinned address the same way. */
export function postgresPoolConfig(config: DriverConnectionConfig, database?: string): pg.PoolConfig {
  const ssl = config.ssl
    ? { rejectUnauthorized: config.tlsVerify ?? false, servername: config.tlsServerName }
    : undefined;
  if (config.connectionString) {
    return {
      connectionString: config.connectionString,
      ssl,
      connectionTimeoutMillis: 5000,
      ...(database ? { database } : {}),
    };
  }
  return {
    host: config.pinnedAddress || config.host || "localhost",
    port: config.port || 5432,
    database: database || config.database || "postgres",
    user: config.user || "postgres",
    password: config.password,
    ssl,
    connectionTimeoutMillis: 5000,
  };
}

export class PostgresDriver implements DatabaseDriver {
  private pool: pg.Pool;

  constructor(config: DriverConnectionConfig) {
    this.pool = new Pool(postgresPoolConfig(config));
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

  /**
   * Runs one aggregate query (a count or a maximum, see `planRiskProbes`)
   * and returns its single number — `null` when there is none (an empty
   * `MAX`). Never used for row data.
   */
  async queryScalar(sql: string): Promise<number | null> {
    const res = await this.pool.query({ text: sql, rowMode: "array" });
    const value = res.rows[0]?.[0];
    return value === null || value === undefined ? null : Number(value);
  }

  /**
   * Inserts seed rows in one transaction, in batches, with bound parameters —
   * never values spliced into the SQL. All or nothing: a failing row rolls the
   * whole table back. Returns the number of rows inserted.
   */
  async insertRows(table: string, columns: string[], rows: (string | null)[][]): Promise<number> {
    if (rows.length === 0) return 0;
    const client = await this.pool.connect();
    const head = `INSERT INTO ${q(table, "postgres")} (${columns.map((c) => q(c, "postgres")).join(", ")}) VALUES `;
    const batch = Math.max(1, Math.min(500, Math.floor(30000 / columns.length)));
    try {
      await client.query("BEGIN");
      for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        let n = 0;
        const values = chunk.map((row) => `(${row.map(() => `$${++n}`).join(", ")})`).join(", ");
        await client.query(head + values, chunk.flat());
      }
      await client.query("COMMIT");
      return rows.length;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
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
