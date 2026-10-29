import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { q } from "@nebuladb/dbml-engine";
import type { Field, Project, Table } from "@nebuladb/shared";
import { ApiError } from "../../../shared/errors.js";
import { CONNECT_TIMEOUT_MS } from "../../../shared/sqlQuoting.js";
import {
  oneBatch,
  type DatabaseDriver,
  type DriverConnectionConfig,
  type MigrationExecutionResult,
  type RowValue,
  type TestConnectionResult,
} from "./interface.js";
import { driverTlsOptions } from "./tls.js";

/** The server answers the HTTP interface on this port, `8443` once TLS is on. */
const HTTP_PORT = 8123;
const HTTPS_PORT = 8443;
const REQUEST_TIMEOUT_MS = 120_000;
/** Rows per `INSERT`: ClickHouse prefers a few big batches to many small ones. */
const INSERT_BATCH = 5_000;

/**
 * Opens the client of a ClickHouse connection — shared with the admin driver (`dbAdmin/drivers/clickhouse.ts`).
 *
 * The client talks HTTP(S). The socket often targets an address rather than the name the user typed (DNS pinning,
 * an SSH tunnel's local end), so the agent resolves that name to the pinned address itself, and the certificate is
 * checked against the typed name (`driverTlsOptions`).
 */
export function openClickHouse(
  config: DriverConnectionConfig,
  database?: string,
): { client: ClickHouseClient; database: string } {
  const tls = driverTlsOptions(config);
  const address = config.pinnedAddress;
  const lookup: net.LookupFunction | undefined = address
    ? (_host, options, callback) => {
        const family = net.isIPv6(address) ? 6 : 4;
        if (options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      }
    : undefined;
  const agent = tls
    ? new https.Agent({ keepAlive: true, ...tls, ...(lookup ? { lookup } : {}) })
    : new http.Agent({ keepAlive: true, ...(lookup ? { lookup } : {}) });

  const name = database || config.database || "default";
  const common = {
    http_agent: agent,
    request_timeout: REQUEST_TIMEOUT_MS,
    connect_timeout: CONNECT_TIMEOUT_MS,
    clickhouse_settings: {
      // Written dates come as ISO text; the 64-bit integers and the decimals are read back exactly, as strings.
      date_time_input_format: "best_effort" as const,
      output_format_json_quote_64bit_integers: 1 as const,
      output_format_json_quote_decimals: 1 as const,
    },
  };
  const client = config.connectionString
    ? createClient({ url: config.connectionString, ...(database ? { database } : {}), ...common })
    : createClient({
        url: `${tls ? "https" : "http"}://${config.tlsHost || config.host || "localhost"}:${config.port || (tls ? HTTPS_PORT : HTTP_PORT)}`,
        username: config.user || "default",
        password: config.password ?? "",
        database: name,
        ...common,
      });
  return { client, database: name };
}

/** `Nullable(String)` → `String`, not null `false`; `LowCardinality(Nullable(String))` too. */
export function clickhouseFieldType(raw: string): { type: string; notNull: boolean } {
  let type = raw.trim();
  let notNull = true;
  for (;;) {
    const inner = /^(Nullable|LowCardinality)\((.*)\)$/s.exec(type);
    if (!inner) break;
    if (inner[1] === "Nullable") notNull = false;
    type = inner[2]!.trim();
  }
  return { type, notNull };
}

/**
 * A value as the `CSV` input format reads it: `\N` for NULL, the text itself when it holds nothing a CSV line gives a
 * meaning to, and quoted otherwise. A number or a boolean is never quoted: a quoted `1` is not a boolean to ClickHouse.
 */
function csvValue(value: RowValue): string {
  if (value === null) return "\\N";
  if (value instanceof Uint8Array)
    throw new ApiError("DB_ADMIN_UNSUPPORTED", { message: "binary values are not supported by ClickHouse seeds" });
  return /^[^\s",\\][^",\r\n\\]*$/.test(value) && !/\s$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
}

/** The statements of a script, comments dropped: ClickHouse takes one statement per request. */
export function clickhouseStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.split("\n").some((line) => line.trim() !== "" && !line.trim().startsWith("--")));
}

export class ClickHouseDriver implements DatabaseDriver {
  private client: ClickHouseClient;
  private databaseName: string;

  constructor(config: DriverConnectionConfig) {
    ({ client: this.client, database: this.databaseName } = openClickHouse(config));
  }

  private async rows<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const result = await this.client.query({ query, query_params: params, format: "JSONEachRow" });
    return result.json<T>();
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const [row] = await this.rows<{ version: string; db: string }>(
        "SELECT version() AS version, currentDatabase() AS db",
      );
      return { ok: true, version: `ClickHouse ${row?.version ?? ""}`.trim(), database: row?.db };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async introspectSchema(): Promise<Project> {
    const db = this.databaseName;
    // A view or a dictionary holds no table of its own to deploy to.
    const tableRows = await this.rows<{ name: string }>(
      `SELECT name FROM system.tables
       WHERE database = {db:String} AND is_temporary = 0
         AND engine NOT IN ('View', 'MaterializedView', 'LiveView', 'WindowView', 'Dictionary')
       ORDER BY name`,
      { db },
    );
    const columnRows = await this.rows<{
      table: string;
      name: string;
      type: string;
      default_kind: string;
      default_expression: string;
      is_in_primary_key: number | string;
    }>(
      `SELECT table, name, type, default_kind, default_expression, is_in_primary_key
       FROM system.columns WHERE database = {db:String} ORDER BY table, position`,
      { db },
    );

    const columnsByTable = new Map<string, typeof columnRows>();
    for (const column of columnRows) {
      const list = columnsByTable.get(column.table) ?? [];
      list.push(column);
      columnsByTable.set(column.table, list);
    }

    const tables: Table[] = tableRows.map((t, idx) => ({
      id: t.name,
      name: t.name,
      fields: (columnsByTable.get(t.name) ?? []).map((c): Field => {
        const { type, notNull } = clickhouseFieldType(c.type);
        const hasDefault = c.default_kind === "DEFAULT" && c.default_expression !== "";
        return {
          id: `${t.name}.${c.name}`,
          name: c.name,
          type,
          pk: Number(c.is_in_primary_key) === 1,
          notNull,
          ...(hasDefault ? { default: c.default_expression } : {}),
        } as Field;
      }),
      indexes: [],
      position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
      detailLevel: "standard" as const,
    }));

    return {
      id: "live-clickhouse-project",
      name: "ClickHouse Live",
      tables,
      refs: [],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    };
  }

  async queryScalar(sql: string): Promise<number | null> {
    const result = await this.client.query({ query: sql, format: "JSONCompactEachRow" });
    const rows = await result.json<unknown[]>();
    const value = rows[0]?.[0];
    return value === null || value === undefined ? null : Number(value);
  }

  /**
   * Seed rows go in as CSV text — "the text as the engine reads it", which is what a seed holds — one `INSERT` per
   * batch. There is no transaction to wrap them: a failing batch leaves the earlier ones in the table.
   */
  async insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number> {
    return this.insertRowBatches(table, columns, oneBatch(rows));
  }

  async insertRowBatches(table: string, columns: string[], batches: AsyncIterable<RowValue[][]>): Promise<number> {
    let total = 0;
    for await (const rows of batches) {
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const chunk = rows.slice(i, i + INSERT_BATCH);
        const csv = chunk.map((row) => row.map(csvValue).join(",")).join("\n");
        await this.client.insert({
          table: q(table, "clickhouse"),
          columns: columns.map((column) => q(column, "clickhouse")) as [string, ...string[]],
          values: Readable.from([csv], { objectMode: false }),
          format: "CSV",
        });
        total += chunk.length;
      }
    }
    return total;
  }

  async queryRows(sql: string): Promise<unknown[][]> {
    const result = await this.client.query({ query: sql, format: "JSONCompactEachRow" });
    return result.json<unknown[]>();
  }

  /**
   * One request per statement, in order: ClickHouse has no transaction around DDL, so a failure leaves what ran
   * before it. `error` names the failing statement (1-indexed), as the other drivers do.
   */
  async executeMigration(sql: string): Promise<MigrationExecutionResult> {
    const statements = clickhouseStatements(sql);
    let executed = 0;
    for (const statement of statements) {
      try {
        await this.client.command({ query: statement });
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
    await this.client.close();
  }
}
