import type { BigQuery, TableMetadata } from "@google-cloud/bigquery";
import type {
  DbAdminCapabilities,
  DbAdminDatabase,
  DbAdminObjectRef,
  DbAdminQueryResult,
  DbAdminSchema,
  DbAdminSession,
  DbBlocking,
  DbServerCounters,
  DbAdminTable,
  DbAdminTableDescription,
  DbGrant,
  DbPrincipal,
  DbPrivilegeCatalog,
} from "@nebuladb/shared";
import { bigQueryColumnType, openBigQuery, plain as plainValue } from "../../connections/drivers/bigquery.js";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { assertReadOnlyStatement } from "../sqlGuard.js";
import { plain, quoteBacktick as q, requireName, toNumber, toResult, trimStatement, unsupported } from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

/**
 * BigQuery: a connection is one dataset of one Google Cloud project, so there
 * is a single "database" to browse and no schema inside it. Accounts and
 * rights are Google Cloud IAM's, sessions and locks do not exist: those parts
 * of the console are switched off by `capabilities`.
 *
 * Every statement is a job, billed by the bytes it reads — browsing a table
 * reads its metadata and one page, never the whole table.
 */
export class BigQueryAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: false,
    schemas: false,
    users: false,
    sessions: false,
    dropDatabase: false,
    principalLevels: false,
    principalHost: false,
  };

  private client: BigQuery;
  private projectId: string;
  private datasetId: string;
  private location: string | undefined;

  constructor(config: DriverConnectionConfig) {
    ({ client: this.client, projectId: this.projectId, datasetId: this.datasetId } = openBigQuery(config));
  }

  private async datasetLocation(): Promise<string | undefined> {
    if (this.location === undefined) {
      const [metadata] = await this.client.dataset(this.datasetId).getMetadata();
      this.location = (metadata as { location?: string }).location;
    }
    return this.location;
  }

  /** One statement, in the dataset: columns in the order BigQuery gives them, at most `maxRows + 1` rows. */
  private async run(sql: string, maxRows: number, timeoutMs?: number): Promise<DbAdminQueryResult> {
    const startedAt = Date.now();
    const [job] = await this.client.createQueryJob({
      query: sql,
      location: await this.datasetLocation(),
      defaultDataset: { projectId: this.projectId, datasetId: this.datasetId },
      useLegacySql: false,
      ...(timeoutMs ? { jobTimeoutMs: timeoutMs } : {}),
    });
    const [rows, , response] = await job.getQueryResults({ maxResults: maxRows + 1, autoPaginate: false });
    // A statement that changes rows answers with how many, and (oddly) the table's columns: it returned no row.
    const affected = toNumber(response?.numDmlAffectedRows);
    if (affected !== null) return toResult([], [], maxRows, startedAt, affected);
    const columns = (response?.schema?.fields ?? []).map((field) => field.name ?? "");
    const values = (rows as Record<string, unknown>[]).map((row) => columns.map((name) => plainValue(row[name])));
    return toResult(columns, values, maxRows, startedAt);
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const size = await this.run(`SELECT SUM(size_bytes) FROM ${q(this.datasetId)}.__TABLES__`, 1).catch(() => null);
    return [{ name: this.datasetId, system: false, sizeBytes: toNumber(size?.rows[0]?.[0]) }];
  }

  async listSchemas(): Promise<DbAdminSchema[]> {
    return [];
  }

  /** From the dataset's own table list: sizes and row counts are metadata, no table is read. */
  async listTables(): Promise<DbAdminTable[]> {
    const result = await this.run(
      `SELECT table_id, type, row_count, size_bytes FROM ${q(this.datasetId)}.__TABLES__ ORDER BY table_id`,
      100_000,
    );
    return result.rows.map(([name, type, rows, bytes]) => ({
      schema: null,
      name: String(name),
      kind: Number(type) === 2 ? "view" : "table",
      rowEstimate: toNumber(rows),
      sizeBytes: toNumber(bytes),
    }));
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const [metadata] = await this.client.dataset(this.datasetId).table(requireName(ref.table, "table")).getMetadata();
    const meta = metadata as TableMetadata;
    const primaryKey = meta.tableConstraints?.primaryKey?.columns ?? [];
    return {
      columns: (meta.schema?.fields ?? []).map((column) => ({
        name: column.name ?? "",
        type: bigQueryColumnType(column),
        nullable: column.mode !== "REQUIRED",
        defaultValue: column.defaultValueExpression ?? null,
        primaryKey: primaryKey.includes(column.name ?? ""),
      })),
      // BigQuery has no index; the primary key is a constraint, listed below.
      indexes: [],
      constraints: [
        ...(primaryKey.length > 0
          ? [{ name: "primary key", type: "PRIMARY KEY", definition: `(${primaryKey.join(", ")}) NOT ENFORCED` }]
          : []),
        ...(meta.tableConstraints?.foreignKeys ?? []).map((fk) => ({
          name: (fk.name ?? "").split(".").pop() ?? "",
          type: "FOREIGN KEY",
          definition: `(${(fk.columnReferences ?? []).map((pair) => pair.referencingColumn).join(", ")}) → ${fk.referencedTable?.tableId}(${(fk.columnReferences ?? []).map((pair) => pair.referencedColumn).join(", ")}) NOT ENFORCED`,
        })),
      ],
    };
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const table = q(requireName(ref.table, "table"));
    return this.run(`SELECT * FROM ${table} LIMIT ${page.limit + 1} OFFSET ${page.offset}`, page.limit);
  }

  async runQuery(sql: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const statement = trimStatement(sql);
    if (options.readOnly) assertReadOnlyStatement(statement, "bigquery");
    return this.run(statement, options.maxRows, options.timeoutMs);
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    if (kind === "database") throw unsupported("dropping a dataset");
    const table = q(requireName(ref.table, "table"));
    if (kind === "column") return [plain(`ALTER TABLE ${table} DROP COLUMN ${q(requireName(ref.column, "column"))}`)];
    return [plain(`DROP ${kind === "view" ? "VIEW" : "TABLE"} ${table}`)];
  }

  privilegeCatalog(): DbPrivilegeCatalog {
    return {};
  }

  async listPrincipals(): Promise<DbPrincipal[]> {
    throw unsupported("user management (access to a dataset is managed in Google Cloud IAM)");
  }

  async listGrants(): Promise<DbGrant[]> {
    throw unsupported("user management (access to a dataset is managed in Google Cloud IAM)");
  }

  userStatements(): AdminStatement[] {
    throw unsupported("user management (access to a dataset is managed in Google Cloud IAM)");
  }

  ownPasswordStatements(): AdminStatement[] {
    throw unsupported("user management (access to a dataset is managed in Google Cloud IAM)");
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

  /** One job per statement, in order: BigQuery runs no DDL inside a transaction, so what ran before a failure stays. */
  async execute(statements: AdminStatement[]): Promise<void> {
    for (const statement of statements) await this.run(statement.sql, 0);
  }

  async close(): Promise<void> {
    // Nothing is held open: every call is an HTTPS request of its own.
  }
}
