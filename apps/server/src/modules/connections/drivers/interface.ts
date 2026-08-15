import type { Project, SchemaRisk } from "@athanordb/shared";
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
