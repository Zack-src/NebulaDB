import { Redis, type RedisOptions } from "ioredis";
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

const DEFAULT_PORT = 6379;
/** Keys read to tell which families of keys a database holds: a database can hold millions. */
const SCAN_LIMIT = 5_000;
const INSERT_BATCH = 1_000;

function unsupported(what: string): ApiError {
  return new ApiError("DB_ADMIN_UNSUPPORTED", { message: `${what} is not supported by this database engine` });
}

/**
 * Opens the client of a Redis (or Valkey) connection — shared with the admin driver (`dbAdmin/drivers/redis.ts`).
 * The connection is opened by the first command. `database` is the number of the logical database (`0`–`15`).
 */
export function openRedis(config: DriverConnectionConfig, database?: string): { redis: Redis; db: number } {
  const tls = driverTlsOptions(config);
  const db = Number.parseInt(database ?? config.database ?? "0", 10) || 0;
  const options: RedisOptions = {
    lazyConnect: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    // A refused connection is an answer, not something to retry in the background.
    retryStrategy: () => null,
    enableOfflineQueue: false,
    ...(tls ? { tls } : {}),
  };
  if (config.connectionString) {
    return { redis: new Redis(config.connectionString, { ...options, ...(database ? { db } : {}) }), db };
  }
  return {
    redis: new Redis({
      ...options,
      host: config.pinnedAddress || config.host || "localhost",
      port: config.port || DEFAULT_PORT,
      db,
      ...(config.user ? { username: config.user } : {}),
      ...(config.password ? { password: config.password } : {}),
    }),
    db,
  };
}

/** What `INFO server` says about the server: Redis and Valkey both answer. */
export function serverVersion(info: string): string {
  const field = (name: string) => new RegExp(`^${name}:(.+)$`, "m").exec(info)?.[1]?.trim();
  const valkey = field("valkey_version");
  return valkey ? `Valkey ${valkey}` : `Redis ${field("redis_version") ?? ""}`.trim();
}

export class RedisDriver implements DatabaseDriver {
  private redis: Redis;
  private db: number;

  constructor(config: DriverConnectionConfig) {
    ({ redis: this.redis, db: this.db } = openRedis(config));
  }

  private async ready(): Promise<void> {
    if (this.redis.status === "wait") await this.redis.connect();
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      await this.ready();
      await this.redis.ping();
      return { ok: true, version: serverVersion(await this.redis.info("server")), database: `db${this.db}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Redis has no schema. What it offers instead is families of keys: those that share the part before the first
   * `:` (`user:1`, `user:2` → `user`) are shown as one table, with a `key` column and, for a hash, its fields.
   */
  async introspectSchema(): Promise<Project> {
    await this.ready();
    const prefixes = new Map<string, string>();
    let cursor = "0";
    let scanned = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, "COUNT", 500);
      cursor = next;
      for (const key of keys) {
        const prefix = key.includes(":") ? key.slice(0, key.indexOf(":")) : key;
        if (!prefixes.has(prefix)) prefixes.set(prefix, key);
      }
      scanned += keys.length;
    } while (cursor !== "0" && scanned < SCAN_LIMIT);

    const tables: Table[] = [];
    for (const [idx, [prefix, sample]] of [...prefixes].sort(([a], [b]) => a.localeCompare(b)).entries()) {
      const kind = await this.redis.type(sample);
      const valueFields = kind === "hash" ? await this.redis.hkeys(sample) : ["value"];
      const fields: Field[] = [
        { id: `${prefix}.key`, name: "key", type: "string", pk: true, notNull: true } as Field,
        ...valueFields.map(
          (name) => ({ id: `${prefix}.${name}`, name, type: "string", pk: false, notNull: false }) as Field,
        ),
      ];
      tables.push({
        id: prefix,
        name: prefix,
        fields,
        indexes: [],
        position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
        detailLevel: "standard" as const,
      });
    }

    return {
      id: "live-redis-project",
      name: "Redis Live",
      tables,
      refs: [],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    };
  }

  /**
   * The only probe is `{"count": "<family>"}`, how many keys a family holds — what the deployment asks before it
   * seeds a table, or drops one. Anything else is not a Redis question.
   */
  async queryScalar(sql: string): Promise<number | null> {
    let family: unknown;
    try {
      family = (JSON.parse(sql) as { count?: unknown }).count;
    } catch {
      throw unsupported("SQL queries");
    }
    if (typeof family !== "string") throw unsupported("this kind of query");
    await this.ready();
    let total = await this.redis.exists(family);
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${family.replace(/[\\*?[\]]/g, "\\$&")}:*`,
        "COUNT",
        1000,
      );
      cursor = next;
      total += keys.length;
    } while (cursor !== "0");
    return total;
  }

  /**
   * A row becomes a hash named `<table>:<value of the first column>` holding the other columns — the usual way to
   * keep a record in Redis. A NULL has no representation: the field is left out.
   */
  async insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number> {
    return this.insertRowBatches(table, columns, oneBatch(rows));
  }

  async insertRowBatches(table: string, columns: string[], batches: AsyncIterable<RowValue[][]>): Promise<number> {
    await this.ready();
    let total = 0;
    for await (const rows of batches) {
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const pipeline = this.redis.pipeline();
        const chunk = rows.slice(i, i + INSERT_BATCH);
        for (const row of chunk) {
          const fields: Record<string, string | Buffer> = {};
          columns.forEach((column, c) => {
            const value = row[c];
            if (value !== null && value !== undefined)
              fields[column] = value instanceof Uint8Array ? Buffer.from(value) : value;
          });
          pipeline.hset(`${table}:${String(row[0] ?? "")}`, fields);
        }
        const results = await pipeline.exec();
        const failed = results?.find(([err]) => err);
        if (failed?.[0]) throw failed[0];
        total += chunk.length;
      }
    }
    return total;
  }

  async queryRows(): Promise<unknown[][]> {
    throw unsupported("reading rows with SQL");
  }

  /** There is nothing to deploy to Redis: a script is empty, or only comments. */
  async executeMigration(script: string): Promise<MigrationExecutionResult> {
    const statements = script.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.trim().startsWith("--"));
    if (statements.length === 0) return { success: true, executedStatements: 0 };
    return {
      success: false,
      executedStatements: 0,
      error: "Redis stores keys, not tables: there is no schema to deploy",
    };
  }

  async close(): Promise<void> {
    if (this.redis.status === "end") return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
