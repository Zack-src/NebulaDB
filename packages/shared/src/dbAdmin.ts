/**
 * Wire types of the database administration console (admin → Connections):
 * what a connected server contains, what a statement returned, who may do
 * what on it. Engine-neutral on purpose — each engine's driver maps its own
 * catalog onto these, and `DbAdminCapabilities` says which parts apply.
 */

export interface DbAdminCapabilities {
  /** The server hosts several databases that can be listed and switched between. */
  multiDatabase: boolean;
  /** Tables live in schemas (namespaces) inside a database. */
  schemas: boolean;
  /** `false` for SQLite: there are no accounts to manage. */
  users: boolean;
  sessions: boolean;
  dropDatabase: boolean;
  /** SQL Server: principals exist at server level (logins) and per database (users). */
  principalLevels: boolean;
  /** MySQL: an account is `user@host`. */
  principalHost: boolean;
}

export interface DbAdminDatabase {
  name: string;
  system: boolean;
  sizeBytes: number | null;
}

export interface DbAdminSchema {
  name: string;
  system: boolean;
}

export interface DbAdminTable {
  schema: string | null;
  name: string;
  kind: "table" | "view";
  rowEstimate: number | null;
  sizeBytes: number | null;
}

export interface DbAdminColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

export interface DbAdminIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface DbAdminConstraint {
  name: string;
  type: string;
  definition: string;
}

export interface DbAdminTableDescription {
  columns: DbAdminColumn[];
  indexes: DbAdminIndex[];
  constraints: DbAdminConstraint[];
}

/** Identifies a table (or, with `column`, one of its columns) on the target server. */
export interface DbAdminObjectRef {
  database?: string;
  schema?: string;
  table?: string;
  column?: string;
}

export interface DbAdminQueryResult {
  columns: string[];
  /** Row-major, every cell already JSON-safe (binary and big numbers arrive as strings). */
  rows: unknown[][];
  /** Rows returned, or rows affected for a statement that returns none. */
  rowCount: number;
  /** True when the row cap cut the result short. */
  truncated: boolean;
  durationMs: number;
}

export interface DbAdminQueryHistoryEntry {
  id: string;
  database: string | null;
  sql: string;
  readOnly: boolean;
  success: boolean;
  rowCount: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

export type DbPrincipalKind = "user" | "role";

export interface DbPrincipal {
  name: string;
  /** MySQL only. */
  host?: string;
  kind: DbPrincipalKind;
  canLogin: boolean;
  locked: boolean;
  superuser: boolean;
  /** Built-in account or role the console refuses to alter. */
  system: boolean;
  memberOf: string[];
}

export type DbGrantScope = "server" | "database" | "schema" | "table";

export interface DbGrant {
  scope: DbGrantScope;
  database?: string;
  schema?: string;
  table?: string;
  privileges: string[];
  grantable: boolean;
  /** SQL Server `DENY`. */
  denied?: boolean;
}

/** The privileges this engine lets you grant at each scope it has. */
export type DbPrivilegeCatalog = Partial<Record<DbGrantScope, string[]>>;

/** Addresses a principal. `database` only matters where principals are per database (SQL Server users). */
export interface DbPrincipalRef {
  name: string;
  host?: string;
  kind?: DbPrincipalKind;
  database?: string;
}

export type DbUserAction =
  | { type: "create"; principal: DbPrincipalRef; password?: string; roles?: string[] }
  | { type: "drop"; principal: DbPrincipalRef }
  | { type: "password"; principal: DbPrincipalRef; password: string }
  | { type: "lock"; principal: DbPrincipalRef; locked: boolean }
  | {
      type: "grant" | "revoke";
      principal: DbPrincipalRef;
      scope: DbGrantScope;
      privileges: string[];
      target?: DbAdminObjectRef;
      withGrantOption?: boolean;
    }
  | { type: "grantRole" | "revokeRole"; principal: DbPrincipalRef; role: string };

export interface DbAdminSession {
  id: string;
  user: string | null;
  database: string | null;
  client: string | null;
  state: string | null;
  query: string | null;
  durationSeconds: number | null;
}

/** Answer to any mutating console call: the statements, and whether they ran. Secrets are masked in `sql`. */
export interface DbAdminStatementsResult {
  sql: string[];
  executed: boolean;
}
