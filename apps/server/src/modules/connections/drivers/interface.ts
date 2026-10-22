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
  close(): Promise<void>;
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
