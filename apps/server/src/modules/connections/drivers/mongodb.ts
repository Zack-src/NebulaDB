import {
  Binary,
  Decimal128,
  Double,
  Int32,
  Long,
  MongoClient,
  type Db,
  type Document,
  type MongoClientOptions,
} from "mongodb";
import type { Field, Project, Table, TableIndex } from "@nebuladb/shared";
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

const DEFAULT_PORT = 27017;
const INSERT_BATCH = 1_000;
/** Documents read from a collection that has no validator, to tell which fields it holds. */
const SAMPLE_SIZE = 200;

function unsupported(what: string): ApiError {
  return new ApiError("DB_ADMIN_UNSUPPORTED", { message: `${what} is not supported by this database engine` });
}

/**
 * Opens the client of a MongoDB connection — shared with the admin driver (`dbAdmin/drivers/mongodb.ts`).
 * Nothing is connected yet: the first command connects.
 */
export function openMongo(
  config: DriverConnectionConfig,
  database?: string,
): { client: MongoClient; database: string } {
  const tls = driverTlsOptions(config);
  const options: MongoClientOptions = {
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    appName: "NebulaDB",
  };
  if (tls) {
    options.tls = true;
    if (tls.ca) options.ca = tls.ca as string;
    if (tls.cert) options.cert = tls.cert as string;
    if (tls.key) options.key = tls.key as string;
    if (tls.rejectUnauthorized === false) options.tlsAllowInvalidCertificates = true;
    if (tls.servername) options.servername = tls.servername;
    if (tls.checkServerIdentity) options.checkServerIdentity = tls.checkServerIdentity;
  }
  if (config.connectionString) {
    const client = new MongoClient(config.connectionString, options);
    // The database a URI names sits after the hosts (`mongodb://h1,h2/db?…`); `new URL` cannot read several hosts.
    const named = /^mongodb:\/\/[^/]*\/([^?]*)/i.exec(config.connectionString)?.[1];
    return { client, database: database || config.database || (named ? decodeURIComponent(named) : "") || "test" };
  }
  const host = config.pinnedAddress || config.host || "localhost";
  const address = host.includes(":") ? `[${host}]` : host;
  const client = new MongoClient(`mongodb://${address}:${config.port || DEFAULT_PORT}`, {
    ...options,
    ...(config.user ? { auth: { username: config.user, password: config.password ?? "" }, authSource: "admin" } : {}),
  });
  return { client, database: database || config.database || "test" };
}

/** The BSON type a field of this name is kept as: a validator's `bsonType`, or the first of its array. */
function bsonTypeOf(spec: Document | undefined): string | undefined {
  const raw = spec?.bsonType as string | string[] | undefined;
  return Array.isArray(raw) ? raw.find((t) => t !== "null") : raw;
}

/** The BSON type name of a value read from a document, as the schema spells a type. */
function typeOfValue(value: unknown): string {
  if (value instanceof Int32) return "int";
  if (value instanceof Long) return "long";
  if (value instanceof Double) return "double";
  if (value instanceof Decimal128) return "decimal";
  if (value instanceof Date) return "date";
  if (value instanceof Binary) return "binData";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
  if (typeof value === "bigint") return "long";
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object")
    return (value as { _bsontype?: string })._bsontype === "ObjectId" ? "objectId" : "object";
  return "string";
}

/** A seed value (text, as a CSV file holds it) as the BSON type its field is validated for. */
function bsonValue(value: RowValue, type: string | undefined): unknown {
  if (value === null) return null;
  if (value instanceof Uint8Array) return new Binary(value);
  switch (type) {
    case "int":
      return Number.isInteger(Number(value)) ? new Int32(Number(value)) : value;
    case "long":
      return /^-?\d+$/.test(value.trim()) ? Long.fromString(value.trim()) : value;
    case "double":
      return Number.isNaN(Number(value)) ? value : new Double(Number(value));
    case "decimal":
      return Number.isNaN(Number(value)) ? value : Decimal128.fromString(value.trim());
    case "bool":
      return /^(1|true|t|yes|y)$/i.test(value.trim());
    case "date": {
      const date = new Date(value.includes("T") || !value.includes(" ") ? value : value.replace(" ", "T") + "Z");
      return Number.isNaN(date.getTime()) ? value : date;
    }
    case "binData":
      return new Binary(Buffer.from(value, "utf8"));
    default:
      return value;
  }
}

/**
 * The fields of a collection: the properties of its validator when it has one (a collection Nebula deployed, each
 * with the type it was written with), else those of its first documents (a collection made by hand).
 */
export async function collectionFields(db: Db, name: string, validator: Document | undefined): Promise<Field[]> {
  const fields: Field[] = [];
  if (validator?.properties) {
    const required = new Set<string>((validator.required as string[] | undefined) ?? []);
    for (const [column, spec] of Object.entries(validator.properties as Record<string, Document>)) {
      fields.push({
        id: `${name}.${column}`,
        name: column,
        type: (spec.description as string | undefined) || bsonTypeOf(spec) || "string",
        pk: false,
        notNull: required.has(column),
      } as Field);
    }
    return fields;
  }
  const seen = new Map<string, string>();
  for (const doc of await db.collection(name).find({}).limit(SAMPLE_SIZE).toArray()) {
    for (const [column, value] of Object.entries(doc))
      if (!seen.has(column) && value !== null) seen.set(column, typeOfValue(value));
  }
  for (const [column, type] of seen) {
    fields.push({
      id: `${name}.${column}`,
      name: column,
      type,
      pk: column === "_id",
      notNull: column === "_id",
    } as Field);
  }
  return fields;
}

export class MongoDriver implements DatabaseDriver {
  private client: MongoClient;
  private db: Db;
  private databaseName: string;

  constructor(config: DriverConnectionConfig) {
    ({ client: this.client, database: this.databaseName } = openMongo(config));
    this.db = this.client.db(this.databaseName);
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      await this.client.connect();
      const info = await this.client.db("admin").command({ buildInfo: 1 });
      // The database is only named: a database exists once it holds a collection.
      await this.db.command({ ping: 1 });
      return { ok: true, version: `MongoDB ${String(info.version ?? "")}`.trim(), database: this.databaseName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async introspectSchema(): Promise<Project> {
    const collections = (await this.db.listCollections({}, { nameOnly: false }).toArray())
      .filter((c) => c.type !== "view" && !c.name.startsWith("system."))
      .sort((a, b) => a.name.localeCompare(b.name));

    const tables: Table[] = [];
    for (const [idx, info] of collections.entries()) {
      const name = info.name;
      const validator = (info.options as { validator?: { $jsonSchema?: Document } } | undefined)?.validator
        ?.$jsonSchema;
      const fields = await collectionFields(this.db, name, validator);

      const indexes: TableIndex[] = [];
      const fieldIdOf = (column: string) => `${name}.${column}`;
      for (const index of await this.db.collection(name).listIndexes().toArray()) {
        if (index.name === "_id_") continue;
        const columns = Object.keys(index.key as Record<string, unknown>);
        const indexName = String(index.name);
        if (indexName === `pk_${name}`) {
          // The primary key: one column marks its field; several make the composite `pk` index of the table.
          for (const field of fields) if (columns.includes(field.name)) field.pk = true;
          if (columns.length > 1)
            indexes.push({
              id: `${name}.${indexName}`,
              name: indexName,
              fieldIds: columns.map(fieldIdOf),
              pk: true,
              unique: true,
            } as TableIndex);
        } else if (columns.length === 1 && indexName === `uq_${name}_${columns[0]}`) {
          const field = fields.find((f) => f.name === columns[0]);
          if (field) field.unique = true;
        } else {
          indexes.push({
            id: `${name}.${indexName}`,
            name: indexName,
            fieldIds: columns.map(fieldIdOf),
            ...(index.unique ? { unique: true } : {}),
          } as TableIndex);
        }
      }

      tables.push({
        id: name,
        name,
        fields,
        indexes,
        position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
        detailLevel: "standard" as const,
      });
    }

    return {
      id: "live-mongodb-project",
      name: "MongoDB Live",
      tables,
      refs: [],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    };
  }

  /** A probe is a JSON command (`{"count": "users"}`), not SQL: the migration planner writes it so for MongoDB. */
  async queryScalar(sql: string): Promise<number | null> {
    let command: Document;
    try {
      command = JSON.parse(sql) as Document;
    } catch {
      throw unsupported("SQL queries");
    }
    const result = await this.db.command(command);
    return typeof result.n === "number" ? result.n : null;
  }

  /**
   * Seed rows become documents, each value converted to the type the collection's validator asks for — an `int` is
   * written as a 32-bit integer, a `long` as a 64-bit one, so that the validator accepts it. There is no
   * transaction across the batches.
   */
  async insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number> {
    return this.insertRowBatches(table, columns, oneBatch(rows));
  }

  async insertRowBatches(table: string, columns: string[], batches: AsyncIterable<RowValue[][]>): Promise<number> {
    const info = (await this.db.listCollections({ name: table }, { nameOnly: false }).toArray())[0];
    const properties =
      (info?.options as { validator?: { $jsonSchema?: { properties?: Record<string, Document> } } } | undefined)
        ?.validator?.$jsonSchema?.properties ?? {};
    const types = columns.map((column) => bsonTypeOf(properties[column]));
    const collection = this.db.collection(table);
    let total = 0;
    for await (const rows of batches) {
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const documents = rows.slice(i, i + INSERT_BATCH).map((row) => {
          const doc: Document = {};
          columns.forEach((column, c) => {
            doc[column] = bsonValue(row[c] ?? null, types[c]);
          });
          return doc;
        });
        await collection.insertMany(documents);
        total += documents.length;
      }
    }
    return total;
  }

  async queryRows(): Promise<unknown[][]> {
    throw unsupported("reading rows with SQL");
  }

  /**
   * The script is one database command per line (see `dbml-engine/mongoMigration.ts`); a line starting with `--`
   * is a comment. Run in order, each through `db.command`: MongoDB runs no DDL in a transaction, so a failure
   * leaves what ran before it.
   */
  async executeMigration(script: string): Promise<MigrationExecutionResult> {
    const lines = script
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("--"));
    let executed = 0;
    for (const line of lines) {
      try {
        await this.db.command(JSON.parse(line) as Document);
        executed++;
      } catch (err) {
        return {
          success: false,
          executedStatements: executed,
          error: `statement ${executed + 1} of ${lines.length} failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return { success: true, executedStatements: executed };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
