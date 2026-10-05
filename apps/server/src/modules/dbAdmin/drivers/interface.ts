import type {
  DbAdminCapabilities,
  DbAdminDatabase,
  DbAdminObjectRef,
  DbAdminQueryResult,
  DbAdminSchema,
  DbAdminSession,
  DbBlocking,
  DbServerCounters,
  DbAdminTable,
  DbAdminTableDescription,
  DbGrant,
  DbPrincipal,
  DbPrincipalRef,
  DbPrivilegeCatalog,
  DbUserAction,
} from "@athanordb/shared";

export interface RunQueryOptions {
  database?: string;
  readOnly: boolean;
  timeoutMs: number;
  maxRows: number;
}

/** One statement to run. `display` is what gets shown, logged and audited — identical except that secrets are masked. */
export interface AdminStatement {
  sql: string;
  display: string;
}

export type DropKind = "database" | "table" | "view" | "column";

/**
 * The administration counterpart of `DatabaseDriver`. That one sees a target
 * as a DBML `Project` to diff and migrate; this one sees it as a server to
 * operate — browse, query, drop, manage accounts. Kept as a separate contract
 * (and separate connections) so neither has to bend to the other's shape.
 *
 * Mutations are two-step on purpose: a `*Statements` method builds the SQL
 * without touching the server, so the console can show exactly what will run,
 * and `execute` runs what was shown.
 */
export interface DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities;

  listDatabases(): Promise<DbAdminDatabase[]>;
  listSchemas(database?: string): Promise<DbAdminSchema[]>;
  listTables(database?: string, schema?: string): Promise<DbAdminTable[]>;
  describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription>;
  browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult>;
  runQuery(sql: string, options: RunQueryOptions): Promise<DbAdminQueryResult>;

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[];

  privilegeCatalog(): DbPrivilegeCatalog;
  listPrincipals(database?: string): Promise<DbPrincipal[]>;
  listGrants(principal: DbPrincipalRef): Promise<DbGrant[]>;
  userStatements(action: DbUserAction): AdminStatement[];

  listSessions(): Promise<DbAdminSession[]>;
  /** Sessions waiting on a lock, with the session holding it; empty where the engine cannot say. */
  listBlocking(): Promise<DbBlocking[]>;
  /** The server's cumulative traffic counters; fields the engine does not have are `null`. */
  readCounters(): Promise<DbServerCounters>;
  killSessionStatements(id: string): AdminStatement[];

  execute(statements: AdminStatement[], database?: string): Promise<void>;
  close(): Promise<void>;
}
