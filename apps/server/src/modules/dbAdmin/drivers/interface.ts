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
} from "@nebuladb/shared";

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

/** What one statement of a row session gave: its rows as the engine's client hands them over, or how many it changed. */
export interface RowStatementResult {
  columns: string[];
  rows: unknown[][];
  affected: number;
}

/** Runs one statement with bound parameters — text or NULL, the server converts — on the session's connection. */
export type RowStatementRunner = (sql: string, params?: (string | null)[]) => Promise<RowStatementResult>;

export interface RowSessionOptions {
  database?: string;
  /** `false`: a reading session. `true`: one transaction, committed when `fn` returns, rolled back when it throws. */
  write: boolean;
  timeoutMs: number;
}

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
  /**
   * The statements by which the account this driver is signed in with gives itself a new
   * password — written so they can only ever reach that account, and so an account with no
   * privilege but its own can run them.
   */
  ownPasswordStatements(password: string, currentPassword: string): AdminStatement[];

  listSessions(): Promise<DbAdminSession[]>;
  /** Sessions waiting on a lock, with the session holding it; empty where the engine cannot say. */
  listBlocking(): Promise<DbBlocking[]>;
  /** The server's cumulative traffic counters; fields the engine does not have are `null`. */
  readCounters(): Promise<DbServerCounters>;
  killSessionStatements(id: string): AdminStatement[];

  execute(statements: AdminStatement[], database?: string): Promise<void>;
  /**
   * One connection held for the explorer's row editing (`rowEdits.ts`): every
   * statement of `fn` runs on it, with bound parameters. Absent on the engines
   * whose rows the console does not edit.
   */
  rowSession?<T>(options: RowSessionOptions, fn: (run: RowStatementRunner) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
