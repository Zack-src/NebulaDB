import { BigQuery, type Dataset, type TableMetadata } from "@google-cloud/bigquery";
import { q } from "@nebuladb/dbml-engine";
import type { Field, Project, Ref, Table, TableIndex } from "@nebuladb/shared";
import type {
  DatabaseDriver,
  DriverConnectionConfig,
  MigrationExecutionResult,
  RowValue,
  TestConnectionResult,
} from "./interface.js";

type SchemaField = NonNullable<NonNullable<TableMetadata["schema"]>["fields"]>[number];

/** The REST API still names three types the way legacy SQL did; GoogleSQL DDL, and so the schema, use the names on the right. */
const REST_TYPE: Record<string, string> = { INTEGER: "INT64", FLOAT: "FLOAT64", BOOLEAN: "BOOL", RECORD: "STRUCT" };

/** A column's type as a `CREATE TABLE` would write it: `STRING(255)`, `NUMERIC(18,6)`, `ARRAY<INT64>`. */
export function bigQueryColumnType(field: SchemaField): string {
  const name = REST_TYPE[field.type ?? ""] ?? field.type ?? "STRING";
  const sized =
    field.maxLength !== undefined
      ? `${name}(${field.maxLength})`
      : field.precision !== undefined
        ? `${name}(${field.precision}${field.scale !== undefined ? `,${field.scale}` : ""})`
        : name;
  return field.mode === "REPEATED" ? `ARRAY<${sized}>` : sized;
}

/**
 * How one value of a seed row — the text at position `index` of a JSON array —
 * becomes a value of the column's type. Booleans are taken as `true`/`false`
 * or `1`/`0`, binary as base64 (what `insertRows` sends for raw bytes).
 */
export function bigQueryValueExpression(type: string | undefined, index: number): string {
  const text = `JSON_VALUE(r, '$[${index}]')`;
  switch (REST_TYPE[type ?? ""] ?? type) {
    case "INT64":
    case "FLOAT64":
    case "NUMERIC":
    case "BIGNUMERIC":
    case "DATE":
    case "TIME":
    case "DATETIME":
    case "TIMESTAMP":
      return `CAST(${text} AS ${REST_TYPE[type ?? ""] ?? type})`;
    case "BOOL":
      return `CAST(CASE ${text} WHEN '1' THEN 'true' WHEN '0' THEN 'false' ELSE ${text} END AS BOOL)`;
    case "BYTES":
      return `FROM_BASE64(${text})`;
    case "JSON":
      return `PARSE_JSON(${text})`;
    default:
      return text;
  }
}

/** What Google's client throws: a message, sometimes a list of reasons. */
function reasonOf(err: unknown): string {
  const errors = (err as { errors?: { reason?: string }[] })?.errors;
  return errors?.[0]?.reason ?? "";
}
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** BigQuery limits how fast one table's definition may change; the request is good, it only came too soon. */
const isRateLimit = (err: unknown) =>
  ["rateLimitExceeded", "jobRateLimitExceeded", "backendError"].includes(reasonOf(err)) ||
  /exceeded rate limits/i.test(messageOf(err));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The client of a BigQuery connection, shared by this driver and the admin
 * console's: `host` is the Google Cloud project, `database` the dataset,
 * `password` — optional — the JSON key of a service account. Throws a message
 * a person can act on when one of them is missing or the key is not JSON.
 */
export function openBigQuery(config: DriverConnectionConfig): {
  client: BigQuery;
  projectId: string;
  datasetId: string;
} {
  let credentials: Record<string, string> | undefined;
  try {
    credentials = config.password?.trim() ? (JSON.parse(config.password) as Record<string, string>) : undefined;
  } catch {
    throw new Error("the service account key is not valid JSON");
  }
  const projectId = config.host?.trim() || credentials?.project_id || "";
  const datasetId = config.database?.trim() ?? "";
  if (!projectId) throw new Error("a BigQuery connection needs the Google Cloud project id");
  if (!datasetId) throw new Error("a BigQuery connection needs the dataset name");
  return { client: new BigQuery({ projectId, ...(credentials ? { credentials } : {}) }), projectId, datasetId };
}

/** One `INSERT` carries its rows as parameters; BigQuery refuses a request over 10 MB. */
const INSERT_MAX_BYTES = 7 * 1024 * 1024;
const METADATA_CONCURRENCY = 8;

/**
 * BigQuery, through Google's client library. A connection is a dataset:
 * `host` is the Google Cloud project, `database` the dataset, and `password`
 * — optional — the JSON key of a service account. Without a key the client
 * uses the credentials of the machine NebulaDB runs on (Application Default
 * Credentials: `gcloud auth application-default login`, or the service
 * account of the VM / container).
 *
 * What differs from the other engines, and why some things are simply absent:
 * no transaction around DDL, no enforced key (primary and foreign keys are
 * declarations the optimizer may use), no unique constraint, no index, no
 * auto-increment.
 */
export class BigQueryDriver implements DatabaseDriver {
  private client: BigQuery | null = null;
  private projectId = "";
  private datasetId = "";
  private setupError: string | null = null;
  private location: string | undefined;

  constructor(config: DriverConnectionConfig) {
    try {
      ({ client: this.client, projectId: this.projectId, datasetId: this.datasetId } = openBigQuery(config));
    } catch (err) {
      this.setupError = messageOf(err);
    }
  }

  private get bigquery(): BigQuery {
    if (!this.client) throw new Error(this.setupError ?? "BigQuery client not available");
    return this.client;
  }

  private get dataset(): Dataset {
    return this.bigquery.dataset(this.datasetId);
  }

  /** The dataset's region, which every job on it has to run in. */
  private async datasetLocation(): Promise<string | undefined> {
    if (this.location === undefined) {
      const [metadata] = await this.dataset.getMetadata();
      this.location = (metadata as { location?: string }).location;
    }
    return this.location;
  }

  /** Runs one statement in the dataset, so that a bare table name is a table of it. */
  private async run(query: string, params?: Record<string, unknown>, types?: Record<string, unknown>) {
    const [rows] = await this.bigquery.query({
      query,
      location: await this.datasetLocation(),
      defaultDataset: { projectId: this.projectId, datasetId: this.datasetId },
      useLegacySql: false,
      ...(params ? { params, types: types as never } : {}),
    });
    return rows as Record<string, unknown>[];
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const location = await this.datasetLocation();
      return { ok: true, version: `BigQuery${location ? ` (${location})` : ""}`, database: this.datasetId };
    } catch (err) {
      return { ok: false, error: messageOf(err) };
    }
  }

  /** Read from the tables' own metadata rather than `INFORMATION_SCHEMA`: no query is billed, and keys come with it. */
  async introspectSchema(): Promise<Project> {
    const [listed] = await this.dataset.getTables();
    const base = listed.filter((table) => (table.metadata as TableMetadata | undefined)?.type !== "VIEW");
    const metadata: TableMetadata[] = new Array(base.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < base.length; i = next++) [metadata[i]] = await base[i].getMetadata();
    };
    await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, base.length) }, worker));

    const described = metadata
      .filter((meta) => meta.type === undefined || meta.type === "TABLE")
      .map((meta) => ({ name: meta.tableReference?.tableId ?? "", meta }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const refs: Ref[] = [];
    const tables: Table[] = described.map(({ name, meta }, idx) => {
      const primaryKey = new Set(meta.tableConstraints?.primaryKey?.columns ?? []);
      const fields: Field[] = (meta.schema?.fields ?? []).map((column) => ({
        id: `${name}.${column.name}`,
        name: column.name ?? "",
        type: bigQueryColumnType(column),
        pk: primaryKey.has(column.name ?? ""),
        notNull: column.mode === "REQUIRED",
        default: column.defaultValueExpression || undefined,
      }));
      for (const fk of meta.tableConstraints?.foreignKeys ?? []) {
        const target = fk.referencedTable?.tableId ?? "";
        // The API gives a constraint back as `table.name`; the schema knows it by its name alone.
        const constraint = (fk.name ?? "").split(".").pop() ?? "";
        for (const pair of fk.columnReferences ?? []) {
          refs.push({
            id: `fk-${refs.length}-${constraint}`,
            name: constraint,
            from: { tableId: name, fieldId: `${name}.${pair.referencingColumn}` },
            to: { tableId: target, fieldId: `${target}.${pair.referencedColumn}` },
            cardinality: "one-to-many" as const,
          });
        }
      }
      return {
        id: name,
        name,
        fields,
        indexes: [] as TableIndex[],
        position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
        detailLevel: "standard" as const,
      };
    });

    return {
      id: "live-bigquery-project",
      name: "BigQuery Live",
      tables,
      refs,
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    };
  }

  /** One aggregate query's single number (see `planRiskProbes`) — `null` when there is none. */
  async queryScalar(sql_: string): Promise<number | null> {
    const [row] = await this.run(sql_);
    const value = row ? Object.values(row)[0] : undefined;
    return value === null || value === undefined ? null : Number(plain(value));
  }

  /**
   * Inserts seed rows with bound parameters: each row travels as the text of a
   * JSON array, and the statement casts every position to its column's type.
   * One statement is all or nothing. Rows are only split over several
   * statements past 7 MB — far above what a seed may weigh — and then an
   * error on a later one leaves the earlier ones in.
   */
  async insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number> {
    if (rows.length === 0) return 0;
    const [metadata] = await this.dataset.table(table).getMetadata();
    const typeOf = new Map(
      ((metadata as TableMetadata).schema?.fields ?? []).map((column) => [column.name?.toLowerCase(), column.type]),
    );
    const target = q(table, "bigquery");
    const values = columns.map((column, i) => bigQueryValueExpression(typeOf.get(column.toLowerCase()), i));
    const statement = `INSERT INTO ${target} (${columns.map((c) => q(c, "bigquery")).join(", ")}) SELECT ${values.join(", ")} FROM UNNEST(@rows) AS r`;

    let batch: string[] = [];
    let bytes = 0;
    const flush = async () => {
      if (batch.length > 0) await this.run(statement, { rows: batch }, { rows: ["STRING"] });
      batch = [];
      bytes = 0;
    };
    for (const row of rows) {
      const text = JSON.stringify(
        row.map((value) => (value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value)),
      );
      if (bytes + text.length > INSERT_MAX_BYTES) await flush();
      batch.push(text);
      bytes += text.length;
    }
    await flush();
    return rows.length;
  }

  /** One `SELECT`'s rows as arrays, in the order of the select list; dates, times and decimals as the text BigQuery sent. */
  async queryRows(sql_: string): Promise<unknown[][]> {
    const rows = await this.run(sql_);
    return rows.map((row) => Object.values(row).map(plain));
  }

  /**
   * Statement by statement, like `MssqlDriver`: BigQuery runs no DDL inside a
   * transaction, so what ran before a failure stays, and the count returned
   * says exactly how far it went. A statement refused only for coming too soon
   * after another change of the same table is tried again.
   */
  async executeMigration(sql_: string): Promise<MigrationExecutionResult> {
    const statements = sql_
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^(BEGIN( TRANSACTION)?|START TRANSACTION|COMMIT)$/i.test(s));

    let executed = 0;
    for (const statement of statements) {
      // A statement that is only comments (a column kept by choice, an index BigQuery does not have) has nothing to run.
      const code = statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      try {
        for (let attempt = 0; code.length > 0; attempt++) {
          try {
            await this.run(statement);
            break;
          } catch (err) {
            if (attempt >= 5 || !isRateLimit(err)) throw err;
            await sleep(2000 * 2 ** attempt);
          }
        }
        executed++;
      } catch (err) {
        return {
          success: false,
          executedStatements: executed,
          error: `statement ${executed + 1} of ${statements.length} failed: ${messageOf(err)}`,
        };
      }
    }
    return { success: true, executedStatements: executed };
  }

  async close(): Promise<void> {
    // Nothing is held open: every call is an HTTPS request of its own.
  }
}

/** Google's client wraps dates, times and decimals in objects; a backup or a count wants the value itself. */
export function plain(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) return value;
  if ("value" in value && typeof (value as { value: unknown }).value === "string")
    return (value as { value: string }).value;
  if (Array.isArray(value)) return value.map(plain);
  return typeof (value as { toString?: unknown }).toString === "function" && value.constructor?.name === "Big"
    ? String(value)
    : value;
}
