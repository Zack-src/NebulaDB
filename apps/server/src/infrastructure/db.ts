import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "../config.js";
import { runMigrations } from "./migrations.js";

/**
 * NebulaDB's own storage: one PostgreSQL database, reached through a pool.
 *
 * The surface is deliberately the one the code was written against —
 * `db.prepare(sql).get/all/run(...)`, `db.exec`, `db.transaction` — except
 * that every call returns a promise. SQL is written with `?` placeholders and
 * numbered here, so a query assembled from fragments never has to count them.
 */

export interface RunResult {
  /** Rows the statement inserted, updated or deleted. */
  changes: number;
}

export interface Statement {
  /** The first row, or `undefined`. */
  get(...params: unknown[]): Promise<unknown>;
  all(...params: unknown[]): Promise<unknown[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

/**
 * Rewrites `?` placeholders as `$1`, `$2`… Quoted strings, quoted identifiers
 * and comments are copied as they are: a `?` inside one is text, not a slot.
 */
export function numberPlaceholders(sql: string): string {
  if (!sql.includes("?")) return sql;
  let out = "";
  let index = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      let end = i + 1;
      // A doubled quote is an escaped one, and re-enters the same loop as a new literal.
      while (end < sql.length && sql[end] !== ch) end++;
      out += sql.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "-" && sql[i + 1] === "-") {
      let end = sql.indexOf("\n", i);
      if (end === -1) end = sql.length;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "/" && sql[i + 1] === "*") {
      let end = sql.indexOf("*/", i + 2);
      end = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "?") {
      out += `$${++index}`;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// Per pool, not `pg.types.setTypeParser`: that one is process-wide and would
// also change what the PostgreSQL *target* driver hands back for a user's
// database. `bigint` and `numeric` come back as strings by default; here they
// are counters, sizes and aggregates (`COUNT(*)`, `SUM`, `AVG`), all well
// within what a JS number holds exactly.
const INT8_OID = 20;
const NUMERIC_OID = 1700;
const types: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => {
    if (format !== "binary" && (oid === INT8_OID || oid === NUMERIC_OID)) return Number;
    return pg.types.getTypeParser(oid, format as "text");
  }) as pg.CustomTypesConfig["getTypeParser"],
};

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
  application_name: "nebuladb",
  types,
  // An idle pool alone must not hold the process open: the CLI entry points
  // and the test files end when their work does. The server stays up through
  // its HTTP listener.
  allowExitOnIdle: true,
});

// Without a listener, a connection the server dropped while idle (a restart,
// a failover) is an unhandled `error` event — a process crash for something
// the pool recovers from on the next query.
pool.on("error", (err) => {
  console.error("[db] idle PostgreSQL connection lost:", err.message);
});

interface TransactionContext {
  client: pg.PoolClient;
  /** Serialises the statements of one transaction: a connection runs one at a time. */
  tail: Promise<unknown>;
  savepoints: number;
  finished: boolean;
}

const transactionStorage = new AsyncLocalStorage<TransactionContext>();

/** The open transaction this call belongs to, if any. One that already ended does not count: what it started and left running goes back to the pool. */
function currentTransaction(): TransactionContext | undefined {
  const context = transactionStorage.getStore();
  return context && !context.finished ? context : undefined;
}

function onClient<T>(context: TransactionContext, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const result = context.tail.then(() => work(context.client));
  context.tail = result.catch(() => {});
  return result;
}

function query(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  const context = currentTransaction();
  if (context) return onClient(context, (client) => client.query(sql, params));
  return pool.query(sql, params);
}

function prepare(sql: string): Statement {
  const text = numberPlaceholders(sql);
  return {
    async get(...params) {
      return (await query(text, params)).rows[0];
    },
    async all(...params) {
      return (await query(text, params)).rows;
    },
    async run(...params) {
      return { changes: (await query(text, params)).rowCount ?? 0 };
    },
  };
}

/** Runs SQL as it is, without parameters. May hold several statements. */
async function exec(sql: string): Promise<void> {
  await query(sql);
}

/**
 * Runs `work` in a transaction: committed when it resolves, rolled back when
 * it throws. Every `db` call made inside — however deep, in whichever module —
 * goes through the same connection, so `work` needs no handle passed around.
 * Called inside a transaction, it becomes a savepoint: a failure caught by the
 * caller undoes this part only.
 */
async function transaction<T>(work: () => Promise<T>): Promise<T> {
  const outer = currentTransaction();
  if (outer) {
    const savepoint = `sp_${++outer.savepoints}`;
    await onClient(outer, (client) => client.query(`SAVEPOINT ${savepoint}`));
    try {
      const result = await work();
      await onClient(outer, (client) => client.query(`RELEASE SAVEPOINT ${savepoint}`));
      return result;
    } catch (err) {
      await onClient(outer, (client) => client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`));
      throw err;
    }
  }

  const client = await pool.connect();
  const context: TransactionContext = { client, tail: Promise.resolve(), savepoints: 0, finished: false };
  let broken: unknown;
  try {
    await client.query("BEGIN");
    const result = await transactionStorage.run(context, work);
    await onClient(context, (c) => c.query("COMMIT"));
    return result;
  } catch (err) {
    try {
      await onClient(context, (c) => c.query("ROLLBACK"));
    } catch (rollbackErr) {
      // The connection itself is gone; the server has rolled back on its own.
      broken = rollbackErr;
    }
    throw err;
  } finally {
    context.finished = true;
    // A connection that could not roll back is destroyed rather than reused.
    client.release(broken instanceof Error ? broken : undefined);
  }
}

/**
 * Whether `err` is PostgreSQL refusing a duplicate — optionally on one named
 * constraint or unique index. How a check that used to be "look, then insert"
 * stays correct now that two requests can be between the look and the insert
 * at once: the index decides, and the loser is told what the look would have.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const error = err as { code?: unknown; constraint?: unknown } | null;
  return error?.code === "23505" && (constraint === undefined || error.constraint === constraint);
}

/** Ends every connection. The last thing a process does with the database. */
async function close(): Promise<void> {
  await pool.end();
}

export const db = { prepare, exec, transaction, close };

export type Database = typeof db;

try {
  await runMigrations(db);
} catch (err) {
  console.error("[db] cannot open the PostgreSQL database NEBULADB_DATABASE_URL points at:", err);
  process.exit(1);
}
