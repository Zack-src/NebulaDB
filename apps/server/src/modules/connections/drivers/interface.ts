import type { DatabaseConnectionConfig, Project } from "@nebuladb/shared";

export interface TestConnectionResult {
  ok: boolean;
  version?: string;
  database?: string;
  error?: string;
  /** Through an SSH tunnel: the SSH server's host key, so a form can pin it. */
  sshHostKeyFingerprint?: string;
}

export interface MigrationExecutionResult {
  success: boolean;
  executedStatements: number;
  error?: string;
}

/** A value bound into an `INSERT`: text as the engine reads it, `NULL`, or raw bytes for a binary column. */
export type RowValue = string | null | Uint8Array;

/** `rows` as the single batch of a stream. */
export async function* oneBatch(rows: RowValue[][]): AsyncGenerator<RowValue[][]> {
  yield rows;
}

export interface DatabaseDriver {
  testConnection(): Promise<TestConnectionResult>;
  introspectSchema(): Promise<Project>;
  /** One aggregate query's single number (`null` for none) — the pre-deployment risk probes. */
  queryScalar(sql: string): Promise<number | null>;
  /** Seed rows, bound parameters, one transaction; returns how many went in. */
  insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number>;
  /** The same for a seed read as a stream of batches: one transaction for the whole table, where the engine has one. */
  insertRowBatches(table: string, columns: string[], batches: AsyncIterable<RowValue[][]>): Promise<number>;
  /** One `SELECT`'s rows as arrays, untruncated and as faithful as the client library allows — what a backup reads. */
  queryRows(sql: string): Promise<unknown[][]>;
  executeMigration(sql: string): Promise<MigrationExecutionResult>;
  /**
   * One connection, one transaction where the engine has one, for a backup
   * restore (see `RestoreSession`). Absent where the driver has none
   * (BigQuery): the restore then goes table by table through the methods above.
   */
  openRestoreSession?(tables: string[]): Promise<RestoreSession>;
  close(): Promise<void>;
}

/** How a table's columns must be treated when rows with explicit values go back in. */
export interface RestoreTableColumns {
  /** Computed by the database (generated, computed, row version): never written, whatever the backup holds. */
  generated: string[];
  /** Identity / auto-increment / serial columns: written with the backup's values, their counter moved after. */
  identity: string[];
}

/**
 * What a restore does to a target, on a single connection: empty tables, put
 * rows back with the ids they had, move identity counters past them, then
 * commit — or roll it all back. Every method runs inside the session's
 * transaction when `atomic`; otherwise each statement stands on its own.
 */
export interface RestoreSession {
  /** Everything done through the session is committed or rolled back as one. */
  readonly atomic: boolean;
  /**
   * How identity counters follow rows inserted with explicit ids: moved by
   * `resyncIdentity` (`resynced`), by the engine on its own (`automatic`), or
   * not at all (`unchanged`).
   */
  readonly identities: "resynced" | "automatic" | "unchanged";
  describeTable(table: string): Promise<RestoreTableColumns>;
  /** Deletes every row (`DELETE`, never `TRUNCATE`, which commits on some engines); returns how many there were. */
  emptyTable(table: string): Promise<number>;
  /** Bound parameters, explicit identity values allowed. Returns how many rows went in. */
  insertRows(table: string, columns: string[], rows: RowValue[][]): Promise<number>;
  /** Moves the counters behind `columns` (from `describeTable`) past the rows now in the table. */
  resyncIdentity(table: string, columns: string[]): Promise<void>;
  commit(): Promise<void>;
  /** Undoes everything since the session opened, when `atomic`; nothing to undo otherwise. Never throws. */
  rollback(): Promise<void>;
  /** Gives the connection back; after `commit` or `rollback`. Never throws. */
  release(): Promise<void>;
}

/**
 * A connection config after `pinConnectionTarget` (see `targetPinning.ts`):
 * the stored fields plus where the socket must actually go. Never persisted.
 */
export interface DriverConnectionConfig extends DatabaseConnectionConfig {
  /** The already-checked address to connect to instead of resolving `host` again. */
  pinnedAddress?: string;
  /** The original host name, for SNI and certificate checks once the socket targets an IP. */
  tlsServerName?: string;
  /** The name the server's certificate must carry — the host the user typed, whatever address the socket goes to. */
  tlsHost?: string;
  /** Whether the server certificate must be verified (a Postgres URL's `sslmode`); wins over the stored `sslVerify`. */
  tlsVerify?: boolean;
}
