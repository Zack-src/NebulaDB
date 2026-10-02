import type { DatabaseConnectionConfig, Project, SchemaRisk } from "@athanordb/shared";
import type { MigrationDiff } from "@athanordb/dbml-engine";

export interface TestConnectionResult {
  ok: boolean;
  version?: string;
  database?: string;
  error?: string;
}

export interface MigrationExecutionResult {
  success: boolean;
  executedStatements: number;
  error?: string;
}

export interface DatabaseDriver {
  testConnection(): Promise<TestConnectionResult>;
  introspectSchema(): Promise<Project>;
  inspectRisks(diff: MigrationDiff): Promise<SchemaRisk[]>;
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
  /** Whether the server certificate must be verified (a Postgres URL's `sslmode`); off by default, as before. */
  tlsVerify?: boolean;
}
