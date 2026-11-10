import type { ClickHouseClient } from "@clickhouse/client";
import type {
  DbAdminCapabilities,
  DbAdminDatabase,
  DbAdminObjectRef,
  DbAdminQueryResult,
  DbAdminSchema,
  DbAdminSession,
  DbAdminTable,
  DbAdminTableDescription,
  DbBlocking,
  DbGrant,
  DbPrincipal,
  DbPrivilegeCatalog,
  DbServerCounters,
} from "@nebuladb/shared";
import { clickhouseFieldType, openClickHouse } from "../../connections/drivers/clickhouse.js";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { assertReadOnlyStatement } from "../sqlGuard.js";
import { plain, quoteBacktick as q, requireName, toNumber, toResult, trimStatement, unsupported } from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

/** Databases ClickHouse keeps for itself. */
const SYSTEM_DATABASES = new Set(["system", "information_schema"]);
/** A statement that answers with rows; anything else is a command. */
const ROW_RETURNING = /^\s*(select|with|show|describe|desc|exists|explain|values|table)\b/i;

/**
 * ClickHouse: a server holds several databases, tables live straight in them (no schema). Accounts are managed
 * with SQL too, but not from here yet, and there is no session or lock monitoring in this console — those parts
 * are switched off by `capabilities`.
 *
 * A read-only console statement is checked by the SQL guard and also run with the server's own `readonly`
 * setting: the first refuses what it can read as a write, the second is the server saying no.
 */
export class ClickHouseAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: true,
    schemas: false,
    users: false,
    sessions: false,
    dropDatabase: false,
    principalLevels: false,
    principalHost: false,
  };

  private client: ClickHouseClient;
  private database: string;
  private config: DriverConnectionConfig;
  private others: ClickHouseClient[] = [];

  constructor(config: DriverConnectionConfig) {
    this.config = config;
    ({ client: this.client, database: this.database } = openClickHouse(config));
  }

  /** The client for `database`: the connection's own, or one opened on that database and closed with the driver. */
  private clientFor(database?: string): ClickHouseClient {
    if (!database || database === this.database) return this.client;
    const { client } = openClickHouse(this.config, database);
    this.others.push(client);
    return client;
  }

  /** One statement: its columns and at most `maxRows + 1` rows. */
  private async run(
    sql: string,
    options: { maxRows: number; readOnly?: boolean; timeoutMs?: number; database?: string },
  ): Promise<DbAdminQueryResult> {
    const startedAt = Date.now();
    const client = this.clientFor(options.database);
    if (!ROW_RETURNING.test(sql)) {
      await client.command({ query: sql });
      return toResult([], [], options.maxRows, startedAt, 0);
    }
    // `readonly` goes last: the server refuses to change a setting once it is on.
    const result = await client.query({
      query: sql,
      format: "JSONCompact",
      clickhouse_settings: {
        max_result_rows: String(options.maxRows + 1),
        result_overflow_mode: "break",
        ...(options.timeoutMs ? { max_execution_time: Math.max(1, Math.ceil(options.timeoutMs / 1000)) } : {}),
        ...(options.readOnly ? { readonly: "1" } : {}),
      },
    });
    const body = (await result.json()) as unknown as { meta?: { name: string }[]; data: unknown[][] };
    return toResult(
      (body.meta ?? []).map((column) => column.name),
      body.data,
      options.maxRows,
      startedAt,
    );
  }

  private async rows<T>(sql: string, params: Record<string, unknown> = {}, database?: string): Promise<T[]> {
    const result = await this.clientFor(database).query({ query: sql, query_params: params, format: "JSONEachRow" });
    return result.json<T>();
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const databases = await this.rows<{ name: string }>("SELECT name FROM system.databases ORDER BY name");
    const sizes = await this.rows<{ database: string; bytes: string }>(
      "SELECT database, sum(bytes_on_disk) AS bytes FROM system.parts WHERE active GROUP BY database",
    ).catch(() => []);
    const sizeOf = new Map(sizes.map((row) => [row.database, toNumber(row.bytes)]));
    return databases.map(({ name }) => ({
      name,
      system: SYSTEM_DATABASES.has(name.toLowerCase()),
      sizeBytes: sizeOf.get(name) ?? null,
    }));
  }

  async listSchemas(): Promise<DbAdminSchema[]> {
    return [];
  }

  /** From the server's own table list: row counts and sizes are metadata, no table is read. */
  async listTables(database?: string): Promise<DbAdminTable[]> {
    const rows = await this.rows<{
      name: string;
      engine: string;
      total_rows: string | null;
      total_bytes: string | null;
    }>(
      `SELECT name, engine, total_rows, total_bytes FROM system.tables
       WHERE database = {db:String} AND is_temporary = 0 ORDER BY name`,
      { db: database || this.database },
    );
    return rows.map((row) => ({
      schema: null,
      name: row.name,
      kind: /View$/.test(row.engine) ? "view" : "table",
      rowEstimate: toNumber(row.total_rows),
      sizeBytes: toNumber(row.total_bytes),
    }));
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const db = ref.database || this.database;
    const table = requireName(ref.table, "table");
    const columns = await this.rows<{
      name: string;
      type: string;
      default_kind: string;
      default_expression: string;
      is_in_primary_key: number | string;
    }>(
      `SELECT name, type, default_kind, default_expression, is_in_primary_key FROM system.columns
       WHERE database = {db:String} AND table = {table:String} ORDER BY position`,
      { db, table },
    );
    const [meta] = await this.rows<{ primary_key: string }>(
      "SELECT primary_key FROM system.tables WHERE database = {db:String} AND name = {table:String}",
      { db, table },
    );
    const skipping = await this.rows<{ name: string; expr: string }>(
      "SELECT name, expr FROM system.data_skipping_indices WHERE database = {db:String} AND table = {table:String}",
      { db, table },
    ).catch(() => []);
    const primary = (meta?.primary_key ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return {
      columns: columns.map((column) => {
        const { type, notNull } = clickhouseFieldType(column.type);
        return {
          name: column.name,
          type,
          nullable: !notNull,
          defaultValue:
            column.default_kind === "DEFAULT" && column.default_expression ? column.default_expression : null,
          primaryKey: Number(column.is_in_primary_key) === 1,
        };
      }),
      indexes: [
        ...(primary.length > 0 ? [{ name: "primary key", columns: primary, unique: false, primary: true }] : []),
        ...skipping.map((index) => ({ name: index.name, columns: [index.expr], unique: false, primary: false })),
      ],
      constraints: [],
    };
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const table = `${q(ref.database || this.database)}.${q(requireName(ref.table, "table"))}`;
    return this.run(`SELECT * FROM ${table} LIMIT ${page.limit + 1} OFFSET ${page.offset}`, {
      maxRows: page.limit,
      readOnly: true,
    });
  }

  async runQuery(sql: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const statement = trimStatement(sql);
    if (options.readOnly) assertReadOnlyStatement(statement, "clickhouse");
    return this.run(statement, {
      maxRows: options.maxRows,
      readOnly: options.readOnly,
      timeoutMs: options.timeoutMs,
      database: options.database,
    });
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    if (kind === "database") throw unsupported("dropping a database");
    const table = `${q(ref.database || this.database)}.${q(requireName(ref.table, "table"))}`;
    if (kind === "column") return [plain(`ALTER TABLE ${table} DROP COLUMN ${q(requireName(ref.column, "column"))}`)];
    return [plain(`DROP ${kind === "view" ? "VIEW" : "TABLE"} ${table}`)];
  }

  privilegeCatalog(): DbPrivilegeCatalog {
    return {};
  }

  async listPrincipals(): Promise<DbPrincipal[]> {
    throw unsupported("user management");
  }

  async listGrants(): Promise<DbGrant[]> {
    throw unsupported("user management");
  }

  userStatements(): AdminStatement[] {
    throw unsupported("user management");
  }

  ownPasswordStatements(): AdminStatement[] {
    throw unsupported("user management");
  }

  async listBlocking(): Promise<DbBlocking[]> {
    throw unsupported("lock monitoring");
  }

  async readCounters(): Promise<DbServerCounters> {
    throw unsupported("server counters");
  }

  async listSessions(): Promise<DbAdminSession[]> {
    throw unsupported("session monitoring");
  }

  killSessionStatements(): AdminStatement[] {
    throw unsupported("session monitoring");
  }

  /** One request per statement, in order: no transaction wraps them, what ran before a failure stays. */
  async execute(statements: AdminStatement[], database?: string): Promise<void> {
    const client = this.clientFor(database);
    for (const statement of statements) await client.command({ query: statement.sql });
  }

  async close(): Promise<void> {
    await Promise.all([this.client, ...this.others].map((client) => client.close().catch(() => {})));
  }
}
