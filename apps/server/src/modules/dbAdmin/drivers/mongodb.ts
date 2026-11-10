import { EJSON } from "bson";
import { Binary, Decimal128, Double, Int32, Long, ObjectId, type Db, type Document, type MongoClient } from "mongodb";
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
import { collectionFields, openMongo } from "../../connections/drivers/mongodb.js";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { plain, requireName, toNumber, toResult, unsupported } from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

const SYSTEM_DATABASES = new Set(["admin", "local", "config"]);

/** What a console command that only reads may be — the first key of the command is its name. */
const READ_COMMANDS = new Set([
  "find",
  "aggregate",
  "count",
  "distinct",
  "listCollections",
  "listIndexes",
  "collStats",
  "dbStats",
  "ping",
  "buildInfo",
  "hello",
  "serverStatus",
]);

/** Commands no console statement may run, whatever the mode: they stop the server, change its settings or its accounts. */
const REFUSED_COMMANDS =
  /^(shutdown|setParameter|replSet\w*|fsync\w*|kill\w*|\w*User\w*|\w*Role\w*|eval|dropDatabase)$/i;

/** A value of a document as something a grid shows: numbers as numbers, big ones and identifiers as text. */
function plainBson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Long || value instanceof Decimal128) return value.toString();
  if (value instanceof Int32 || value instanceof Double) return value.valueOf();
  if (value instanceof Binary) return Buffer.from(value.buffer.subarray(0, value.position));
  if (value instanceof Date || typeof value !== "object") return value;
  return EJSON.stringify(value as Document, { relaxed: true });
}

/** Documents as a grid: the columns are the fields met, in the order they were first seen. */
function documentsToRows(documents: Document[]): { columns: string[]; rows: unknown[][] } {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    for (const key of Object.keys(doc)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return { columns, rows: documents.map((doc) => columns.map((column) => plainBson(doc[column]))) };
}

/** A command typed in the console: Extended JSON, an object whose first key names the command. */
function parseCommand(text: string): Document {
  let command: unknown;
  try {
    command = EJSON.parse(text, { relaxed: true });
  } catch {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", {
      message: 'the console takes a MongoDB command as JSON, e.g. {"find": "users", "limit": 10}',
    });
  }
  if (command === null || typeof command !== "object" || Array.isArray(command) || Object.keys(command).length === 0) {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "the command must be a JSON object" });
  }
  return command as Document;
}

/**
 * MongoDB: a connection is a server with several databases, each holding collections — shown as tables, their
 * fields read from the collection's validator or from a sample of its documents. Accounts are not managed from
 * here, and sessions and locks are not monitored: those parts of the console are switched off by `capabilities`.
 *
 * The console takes a database command as JSON. A read-only statement is limited to the commands that read
 * (`READ_COMMANDS`), and an aggregation may not write (`$out`, `$merge`).
 */
export class MongoAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: true,
    schemas: false,
    users: false,
    sessions: false,
    dropDatabase: false,
    principalLevels: false,
    principalHost: false,
  };

  private client: MongoClient;
  private database: string;

  constructor(config: DriverConnectionConfig) {
    ({ client: this.client, database: this.database } = openMongo(config));
  }

  private db(database?: string): Db {
    return this.client.db(database || this.database);
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const { databases } = await this.client.db("admin").admin().listDatabases();
    const list: DbAdminDatabase[] = databases.map((entry) => ({
      name: entry.name,
      system: SYSTEM_DATABASES.has(entry.name),
      sizeBytes: toNumber(entry.sizeOnDisk),
    }));
    // A database exists once it holds a collection: the connection's own is offered before that.
    if (!list.some((entry) => entry.name === this.database))
      list.push({ name: this.database, system: false, sizeBytes: 0 });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listSchemas(): Promise<DbAdminSchema[]> {
    return [];
  }

  /** Collections and views; the row count and the size are the server's own estimates, no collection is read. */
  async listTables(database?: string): Promise<DbAdminTable[]> {
    const db = this.db(database);
    const collections = (await db.listCollections({}, { nameOnly: false }).toArray())
      .filter((c) => !c.name.startsWith("system."))
      .sort((a, b) => a.name.localeCompare(b.name));
    return Promise.all(
      collections.map(async (info) => {
        const stats = await db
          .collection(info.name)
          .aggregate([{ $collStats: { storageStats: {} } }])
          .next()
          .catch(() => null);
        const storage = (stats as { storageStats?: { count?: number; storageSize?: number } } | null)?.storageStats;
        return {
          schema: null,
          name: info.name,
          kind: info.type === "view" ? ("view" as const) : ("table" as const),
          rowEstimate: toNumber(storage?.count),
          sizeBytes: toNumber(storage?.storageSize),
        };
      }),
    );
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const db = this.db(ref.database);
    const name = requireName(ref.table, "collection");
    const info = (await db.listCollections({ name }, { nameOnly: false }).toArray())[0];
    const validator = (info?.options as { validator?: { $jsonSchema?: Document } } | undefined)?.validator?.$jsonSchema;
    const fields = await collectionFields(db, name, validator);
    const indexes = await db
      .collection(name)
      .listIndexes()
      .toArray()
      .catch(() => []);
    const primaryColumns = new Set(
      indexes
        .filter((index) => index.name === `pk_${name}` || index.name === "_id_")
        .flatMap((index) => Object.keys(index.key)),
    );
    return {
      columns: fields.map((field) => ({
        name: field.name,
        type: field.type,
        nullable: !field.notNull,
        defaultValue: null,
        primaryKey: primaryColumns.has(field.name),
      })),
      indexes: indexes.map((index) => ({
        name: String(index.name),
        columns: Object.keys(index.key),
        unique: Boolean(index.unique) || index.name === "_id_",
        primary: index.name === `pk_${name}` || index.name === "_id_",
      })),
      constraints: validator ? [{ name: "validator", type: "CHECK", definition: JSON.stringify(validator) }] : [],
    };
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const startedAt = Date.now();
    const documents = await this.db(ref.database)
      .collection(requireName(ref.table, "collection"))
      .find({})
      .skip(page.offset)
      .limit(page.limit + 1)
      .toArray();
    const { columns, rows } = documentsToRows(documents);
    return toResult(columns, rows, page.limit, startedAt);
  }

  async runQuery(text: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const startedAt = Date.now();
    const command = parseCommand(text);
    const name = Object.keys(command)[0]!;
    if (REFUSED_COMMANDS.test(name)) {
      throw new ApiError("DB_ADMIN_WRITE_NOT_ALLOWED", {
        message: `the ${name} command cannot be run from the console`,
      });
    }
    if (options.readOnly) {
      if (!READ_COMMANDS.has(name)) {
        throw new ApiError("DB_ADMIN_WRITE_NOT_ALLOWED", {
          message: `read-only mode: the ${name} command is not allowed — switch the console to write mode to run it`,
        });
      }
      if (name === "aggregate" && JSON.stringify(command.pipeline ?? []).match(/"\$(out|merge)"/)) {
        throw new ApiError("DB_ADMIN_WRITE_NOT_ALLOWED", {
          message: "read-only mode: $out and $merge write documents",
        });
      }
    }

    // A result is cut at the row cap, and a command that runs too long is stopped by the server.
    if (name === "find" && command.limit === undefined) command.limit = options.maxRows + 1;
    if (name === "aggregate") {
      command.cursor ??= { batchSize: options.maxRows + 1 };
      command.pipeline = [...((command.pipeline as Document[] | undefined) ?? []), { $limit: options.maxRows + 1 }];
    }
    if (["find", "aggregate", "count", "distinct"].includes(name)) command.maxTimeMS ??= options.timeoutMs;

    const reply = await this.db(options.database).command(command);
    const batch = (reply.cursor as { firstBatch?: Document[] } | undefined)?.firstBatch;
    if (batch) {
      const { columns, rows } = documentsToRows(batch);
      return toResult(columns, rows, options.maxRows, startedAt);
    }
    if (Array.isArray(reply.values)) {
      return toResult(
        ["value"],
        (reply.values as unknown[]).map((value) => [plainBson(value)]),
        options.maxRows,
        startedAt,
      );
    }
    // Any other answer is one document: its fields, the bookkeeping of the server left out.
    const document = Object.fromEntries(
      Object.entries(reply).filter(([key]) => !["ok", "$clusterTime", "operationTime"].includes(key)),
    );
    const { columns, rows } = documentsToRows([document]);
    return toResult(columns, rows, options.maxRows, startedAt);
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    if (kind === "database") throw unsupported("dropping a database");
    const collection = requireName(ref.table, "collection");
    if (kind === "column") {
      const field = requireName(ref.column, "field");
      return [
        plain(
          JSON.stringify({ update: collection, updates: [{ q: {}, u: { $unset: { [field]: "" } }, multi: true }] }),
        ),
      ];
    }
    return [plain(JSON.stringify({ drop: collection }))];
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

  /** The statements of this driver are JSON commands (`dropStatements`): run in order, no transaction around them. */
  async execute(statements: AdminStatement[], database?: string): Promise<void> {
    const db = this.db(database);
    for (const statement of statements) await db.command(parseCommand(statement.sql));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
