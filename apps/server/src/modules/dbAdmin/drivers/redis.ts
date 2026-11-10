import type { Redis } from "ioredis";
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
import { ApiError } from "../../../shared/errors.js";
import { openRedis } from "../../connections/drivers/redis.js";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { requireName, toResult, unsupported } from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

/** Keys looked at to list the families of a database, and the most that one page of a family reads. */
const SCAN_LIMIT = 100_000;
const SAMPLE_KEYS = 50;

/** Commands that only read: all a read-only console statement may run. */
const READ_COMMANDS = new Set(
  `GET MGET STRLEN GETRANGE EXISTS TYPE TTL PTTL EXPIRETIME HGET HMGET HGETALL HKEYS HVALS HLEN HEXISTS HSTRLEN
  LRANGE LLEN LINDEX SMEMBERS SCARD SISMEMBER SMISMEMBER SRANDMEMBER ZRANGE ZRANGEBYSCORE ZREVRANGE ZCARD ZSCORE ZRANK
  ZCOUNT SCAN HSCAN SSCAN ZSCAN KEYS RANDOMKEY DBSIZE INFO PING TIME LASTSAVE XLEN XRANGE XREVRANGE BITCOUNT GETBIT
  OBJECT MEMORY DUMP`.split(/\s+/),
);

/** Commands no console statement may run, whatever the mode: they stop the server, change it, run code or block. */
const REFUSED_COMMANDS = new Set(
  `SHUTDOWN DEBUG CONFIG REPLICAOF SLAVEOF MODULE MIGRATE ACL EVAL EVALSHA EVAL_RO EVALSHA_RO FUNCTION SCRIPT SAVE BGSAVE
  BGREWRITEAOF CLIENT FAILOVER MONITOR SUBSCRIBE PSUBSCRIBE SSUBSCRIBE BLPOP BRPOP BLMOVE BLMPOP BZPOPMIN BZPOPMAX
  BRPOPLPUSH XREAD XREADGROUP WAIT WAITAOF SELECT FLUSHALL SWAPDB`.split(/\s+/),
);

/** A command line as words: a word in single or double quotes may hold blanks. */
export function tokenize(line: string): string[] {
  const words: string[] = [];
  for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g)) {
    words.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1"));
  }
  return words;
}

/** A glob special in a `MATCH` pattern, escaped, so that a key family is matched by its name and nothing else. */
const globEscape = (text: string) => text.replace(/[\\*?[\]]/g, "\\$&");

/** One value of a reply as a cell: text and numbers as they are, anything nested as JSON. */
function cell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/**
 * Redis (and Valkey): a server holds numbered databases (`0`–`15`), each holding keys. Keys that share the part
 * before the first `:` are shown as one table — a family — with a `key` column and, for hashes, a column per
 * field. Accounts, sessions and locks are not managed from here: those parts are switched off by `capabilities`.
 *
 * The console takes a command line (`HGETALL user:1`). A read-only statement is limited to the commands that
 * read (`READ_COMMANDS`); the ones that stop the server, change its settings or run code are refused in every mode.
 */
export class RedisAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: true,
    schemas: false,
    users: false,
    sessions: false,
    dropDatabase: false,
    principalLevels: false,
    principalHost: false,
  };

  private redis: Redis;
  private db: number;
  private config: DriverConnectionConfig;
  private others: Redis[] = [];

  constructor(config: DriverConnectionConfig) {
    this.config = config;
    ({ redis: this.redis, db: this.db } = openRedis(config));
  }

  /** The client for logical database `database`: the connection's own, or another closed with the driver. */
  private async clientFor(database?: string): Promise<Redis> {
    let client = this.redis;
    if (database !== undefined && database !== "" && Number.parseInt(database, 10) !== this.db) {
      ({ redis: client } = openRedis(this.config, database));
      this.others.push(client);
    }
    if (client.status === "wait") await client.connect();
    return client;
  }

  /** The keys of a family: `<family>:*`, and the key that is the family's own name. */
  private async familyKeys(client: Redis, family: string, wanted: number): Promise<string[]> {
    const keys: string[] = [];
    if (await client.exists(family)) keys.push(family);
    let cursor = "0";
    do {
      const [next, batch] = await client.scan(cursor, "MATCH", `${globEscape(family)}:*`, "COUNT", 1000);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < wanted);
    return keys.slice(0, wanted);
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const client = await this.clientFor();
    const keyspace = await client.info("keyspace");
    const used = new Set([...keyspace.matchAll(/^db(\d+):/gm)].map((match) => Number(match[1])));
    used.add(this.db);
    return [...used].sort((a, b) => a - b).map((index) => ({ name: String(index), system: false, sizeBytes: null }));
  }

  async listSchemas(): Promise<DbAdminSchema[]> {
    return [];
  }

  /** The families of keys of a database, with how many keys each holds (up to the scan limit). */
  async listTables(database?: string): Promise<DbAdminTable[]> {
    const client = await this.clientFor(database);
    const counts = new Map<string, number>();
    let cursor = "0";
    let scanned = 0;
    do {
      const [next, keys] = await client.scan(cursor, "COUNT", 1000);
      cursor = next;
      for (const key of keys) {
        const family = key.includes(":") ? key.slice(0, key.indexOf(":")) : key;
        counts.set(family, (counts.get(family) ?? 0) + 1);
      }
      scanned += keys.length;
    } while (cursor !== "0" && scanned < SCAN_LIMIT);
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ schema: null, name, kind: "table" as const, rowEstimate: count, sizeBytes: null }));
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const client = await this.clientFor(ref.database);
    const family = requireName(ref.table, "key family");
    const keys = await this.familyKeys(client, family, SAMPLE_KEYS);
    const fields = new Set<string>();
    let hashes = keys.length > 0;
    for (const key of keys) {
      if ((await client.type(key)) !== "hash") hashes = false;
      else for (const field of await client.hkeys(key)) fields.add(field);
    }
    const names = hashes ? [...fields] : ["value"];
    return {
      columns: [
        { name: "key", type: "string", nullable: false, defaultValue: null, primaryKey: true },
        ...names.map((name) => ({ name, type: "string", nullable: true, defaultValue: null, primaryKey: false })),
      ],
      indexes: [],
      constraints: [],
    };
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const startedAt = Date.now();
    const client = await this.clientFor(ref.database);
    const keys = (
      await this.familyKeys(client, requireName(ref.table, "key family"), page.offset + page.limit + 1)
    ).slice(page.offset);
    const types = await Promise.all(keys.map((key) => client.type(key)));
    const values = await Promise.all(
      keys.map(async (key, i) => {
        switch (types[i]) {
          case "string":
            return client.get(key);
          case "hash":
            return client.hgetall(key);
          case "list":
            return client.lrange(key, 0, 99);
          case "set":
            return client.smembers(key);
          case "zset":
            return client.zrange(key, "0", "99", "WITHSCORES");
          default:
            return null;
        }
      }),
    );
    // Only hashes: a column per field. Anything else: the type and the value, as text.
    if (keys.length > 0 && types.every((type) => type === "hash")) {
      const columns = ["key"];
      for (const value of values)
        for (const field of Object.keys(value as Record<string, string>))
          if (!columns.includes(field)) columns.push(field);
      return toResult(
        columns,
        keys.map((key, i) =>
          columns.map((column) => (column === "key" ? key : ((values[i] as Record<string, string>)[column] ?? null))),
        ),
        page.limit,
        startedAt,
      );
    }
    return toResult(
      ["key", "type", "value"],
      keys.map((key, i) => [key, types[i], cell(values[i])]),
      page.limit,
      startedAt,
    );
  }

  async runQuery(text: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const startedAt = Date.now();
    const words = tokenize(text.trim().replace(/;+\s*$/, ""));
    const name = (words[0] ?? "").toUpperCase();
    if (name === "") throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "the command is empty" });
    if (REFUSED_COMMANDS.has(name)) {
      throw new ApiError("DB_ADMIN_WRITE_NOT_ALLOWED", {
        message: `the ${name} command cannot be run from the console`,
      });
    }
    if (options.readOnly && !READ_COMMANDS.has(name)) {
      throw new ApiError("DB_ADMIN_WRITE_NOT_ALLOWED", {
        message: `read-only mode: ${name} is not allowed — switch the console to write mode to run it`,
      });
    }
    const client = await this.clientFor(options.database);
    const reply: unknown = await client.call(words[0]!, ...words.slice(1));
    if (name === "HGETALL" && Array.isArray(reply)) {
      const pairs: unknown[][] = [];
      for (let i = 0; i < reply.length; i += 2) pairs.push([reply[i], reply[i + 1]]);
      return toResult(["field", "value"], pairs, options.maxRows, startedAt);
    }
    const rows = Array.isArray(reply) ? reply.map((value) => [cell(value)]) : [[cell(reply)]];
    return toResult(["value"], rows, options.maxRows, startedAt);
  }

  dropStatements(_kind: DropKind): AdminStatement[] {
    throw unsupported("dropping keys from the explorer (run DEL or UNLINK in the console, in write mode)");
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

  /** Command lines, run in order. */
  async execute(statements: AdminStatement[], database?: string): Promise<void> {
    const client = await this.clientFor(database);
    for (const statement of statements) {
      const words = tokenize(statement.sql);
      if (REFUSED_COMMANDS.has((words[0] ?? "").toUpperCase())) throw unsupported(`the ${words[0]} command`);
      await client.call(words[0]!, ...words.slice(1));
    }
  }

  async close(): Promise<void> {
    await Promise.all(
      [this.redis, ...this.others].map(async (client) => {
        if (client.status !== "end") await client.quit().catch(() => client.disconnect());
      }),
    );
  }
}
