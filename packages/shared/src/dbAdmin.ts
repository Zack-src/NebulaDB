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
  /** Computed by the database from other columns, or an always-generated identity: never written. */
  generated?: boolean;
  /** An identity / auto-increment column: the database fills it when an insert leaves it out. */
  autoValue?: boolean;
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

/**
 * A statement kept under a name on a connection. Private to its author unless
 * `shared`, then readable by everyone who can use the SQL console of that
 * connection. Saving never runs it and gives no right.
 */
export interface DbSavedQuery {
  id: string;
  name: string;
  sql: string;
  description: string | null;
  shared: boolean;
  /** The caller wrote it: only then can it be edited. */
  mine: boolean;
  /** Display name (or email) of the author. */
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One statement shape run through Nebula's SQL console on a connection,
 * aggregated (`GET /api/admin/connections/:id/query-stats`). `sql` has every
 * literal replaced by `?` — never a value, never a result. Durations are
 * measured by Nebula around the call (opening the connection included), not
 * read from the database server.
 */
export interface DbQueryStat {
  hash: string;
  sql: string;
  executions: number;
  failures: number;
  avgMs: number;
  maxMs: number;
  totalMs: number;
  /** Average rows returned or affected, over the executions that succeeded. */
  avgRows: number | null;
  lastAt: string;
  lastUserName: string | null;
}

/** A statement shape that motivates an index suggestion, with what Nebula measured of it. */
export interface DbIndexSuggestionStatement {
  hash: string;
  sql: string;
  executions: number;
  avgMs: number;
  maxMs: number;
  totalMs: number;
}

/**
 * An index the statements run through the SQL console would use and the database does not have.
 * Everything but `createStatement` is measured or read; nothing is predicted.
 */
export interface DbIndexSuggestion {
  schema: string | null;
  table: string;
  /** Equality columns first, then one range column or the sort columns. */
  columns: string[];
  /** The statements that motivate it, the longest total time first, at most five. */
  statements: DbIndexSuggestionStatement[];
  /** Over every motivating statement, not only the ones listed. */
  statementCount: number;
  executions: number;
  totalMs: number;
  /** Share, in percent, of the time measured on the connection (all the statements read) that these statements account for. */
  shareOfMeasuredMs: number;
  /** `CREATE INDEX` in the connection engine's dialect, to copy; nothing is ever run. */
  createStatement: string;
}

export interface DbIndexSuggestions {
  /** The database the existing indexes were read from. */
  database: string | null;
  suggestions: DbIndexSuggestion[];
  /** The projects attached to the connection, where the index can be added to the schema. */
  projects: { id: string; name: string }[];
}

/**
 * The server's own cumulative counters, as one read. A field is `null` when
 * the engine has no such counter (or the account may not read it) — never
 * an estimate. `queriesKind` says what "queries" counts here.
 */
export interface DbServerCounters {
  queries: number | null;
  queriesKind: "statements" | "transactions" | "batches" | "calls";
  bytesOut: number | null;
  bytesIn: number | null;
  rows: number | null;
}

/** A session waiting for a lock another one holds. */
export interface DbBlocking {
  blocked: string;
  blocker: string;
}

/** The "Santé" tab of a connection: every part is `null` when the engine or the account cannot give it. */
export interface DbHealthBoard {
  status: {
    ok: boolean;
    version: string | null;
    latencyMs: number | null;
    checkedAt: string | null;
    error: string | null;
  };
  /** Latency of the last probes, oldest first (7 days kept). */
  history: { at: string; ok: boolean; latencyMs: number }[];
  databases: { name: string; sizeBytes: number | null; system: boolean }[] | null;
  sessions: {
    total: number;
    active: number;
    idle: number;
    longestSeconds: number | null;
    longestUser: string | null;
  } | null;
  blocking: DbBlocking[] | null;
}

/** One period of traffic, the difference between two reads of the counters. */
export interface DbTrafficBucket {
  start: string;
  queries: number | null;
  bytesOut: number | null;
  bytesIn: number | null;
  rows: number | null;
}

/** One session fingerprint the database server showed, summed over the period. */
export interface DbActivityEntry {
  fingerprint: string;
  user: string | null;
  database: string | null;
  client: string | null;
  state: string | null;
  /** Literals masked; empty for a connection seen with no statement. */
  sql: string;
  /** In how many samples it appeared. */
  seen: number;
  maxSeconds: number;
  firstAt: string;
  lastAt: string;
  /** The account is one Nebula signs in with here (by name only). */
  knownAccount: boolean;
}

export interface DbActivityWatch {
  enabled: boolean;
  lastSampledAt: string | null;
  lastError: string | null;
}

export type DbQueryStatSort = "frequency" | "slowest" | "total";

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

// ---- Row editing (the explorer's data grid) ------------------------------------

/**
 * A cell as row editing reads and writes it: the value as text in the
 * engine's own form, or `null` for SQL NULL — never a JSON number, so a big
 * integer or a decimal keeps every digit, and `""` is the empty string.
 */
export type DbRowCell = string | null;

/** What a column holds, as far as its type says: picks the input and the checks, not the SQL. */
export type DbRowColumnKind =
  "integer" | "decimal" | "float" | "boolean" | "text" | "datetime" | "json" | "binary" | "other";

/**
 * Why a column is shown but never written. `generated`: computed by the
 * database. `binary`: bytes, shown as a hexadecimal excerpt. `untyped`: a
 * SQLite column declared without a type, whose values would silently change
 * class. `unsupported`: a type that does not survive a round trip as text.
 */
export type DbRowColumnLock = "generated" | "binary" | "untyped" | "unsupported";

export interface DbRowEditColumn {
  name: string;
  type: string;
  kind: DbRowColumnKind;
  nullable: boolean;
  /** Left out of an insert, the column takes its default (or its identity / auto-increment value). */
  hasDefault: boolean;
  primaryKey: boolean;
  readOnly: DbRowColumnLock | null;
  /** For `boolean`: how this engine writes true and false. */
  booleanValues?: [string, string];
}

/**
 * Why the rows of a table cannot be edited. `engine`: not offered on this
 * engine. `no-primary-key`: nothing identifies one row (a view, too).
 * `key-type`: the key cannot be compared faithfully as text.
 */
export type DbRowEditRefusal = "engine" | "no-primary-key" | "key-type" | "read-only-connection" | "read-access";

export interface DbRowEditing {
  editable: boolean;
  reason: DbRowEditRefusal | null;
  /** The primary key's columns: what identifies the one row a change targets. */
  key: string[];
  columns: DbRowEditColumn[];
  /** Ceilings of one apply. */
  maxOperations: number;
  maxBytes: number;
}

/** A page of a table for the grid. When `editing.editable`, every cell of `result` is a `DbRowCell`. */
export interface DbEditableRows {
  editing: DbRowEditing;
  result: DbAdminQueryResult;
  /** `[row, column]` of the cells whose value is not shown whole (cut short, or bytes): not editable. */
  partial: [number, number][];
  limit: number;
  offset: number;
}

/**
 * One change to one row. `key`: the row's primary key as it was read.
 * `original`: the cells as they were displayed — for an update at least the
 * edited columns, for a delete the whole row; the server refuses the batch
 * when the row no longer shows those values.
 */
export type DbRowOperation =
  | { type: "insert"; values: Record<string, DbRowCell> }
  | {
      type: "update";
      key: Record<string, string>;
      original: Record<string, DbRowCell>;
      values: Record<string, DbRowCell>;
    }
  | { type: "delete"; key: Record<string, string>; original: Record<string, DbRowCell> };

export interface DbRowEditCounts {
  insert: number;
  update: number;
  delete: number;
}

/** The statements of a batch, values written out in the engine's dialect, and whether they ran. */
export interface DbRowEditResult {
  sql: string[];
  executed: boolean;
  counts: DbRowEditCounts;
}

// ---- Structure policy ("structure goes through the schema") -------------------

/**
 * What the console does with an action that changes tables or indexes on a
 * database some project models.
 *
 * `schema-only`: refused — the change is made in the schema editor and
 * deployed, where it has history, review and rollback. `warn`: allowed after
 * an explicit confirmation, and recorded in the audit log as made outside the
 * schema. `free`: no restriction (the console's behaviour before this existed).
 */
export type StructurePolicy = "schema-only" | "warn" | "free";

export const STRUCTURE_POLICIES: readonly StructurePolicy[] = ["schema-only", "warn", "free"];

export interface StructurePolicySetting {
  policy: StructurePolicy;
  /** Also applies to statements typed in the SQL console, not only to the explorer's own drop actions. */
  applyToSql: boolean;
}

/** The policy in force on one connection, and where it comes from. */
export interface EffectiveStructurePolicy extends StructurePolicySetting {
  source: "connection" | "instance";
  /**
   * The projects modelling this database. With none, nothing is intercepted
   * whatever the policy says: there is no schema for the structure to go through.
   */
  projects: { id: string; name: string }[];
}

/** One structural change found in a statement or requested from the explorer. */
export interface StructuralAction {
  verb: "create" | "alter" | "drop" | "rename";
  kind: "table" | "index";
  /** As written when it could be read; `null` for a quoted or computed name. */
  object: string | null;
  /** Set for the explorer's "drop column". */
  column?: string;
}

/** Body of a `STRUCTURE_VIA_SCHEMA` / `STRUCTURE_CONFIRMATION_REQUIRED` error. */
export interface StructurePolicyRefusal {
  policy: StructurePolicy;
  actions: StructuralAction[];
  projects: { id: string; name: string }[];
}

// ---- Database access for members (granted by an instance administrator) ----

/**
 * What an instance administrator grants a member (or a team) on one
 * connection. `read`: the explorer and read-only SQL. `write`: also data
 * writes (`INSERT` / `UPDATE` / `DELETE` / `MERGE`), each confirmed. Never
 * structure, accounts, sessions, backups or drops — those stay the instance
 * administrator's.
 */
export type DbAccessLevel = "read" | "write";
export const DB_ACCESS_LEVELS: readonly DbAccessLevel[] = ["read", "write"];

/** What the console may do on a connection for the person looking at it. */
export type DbConsoleAccess = "admin" | DbAccessLevel;

/** One connection in a grant list. `level: null` keeps only the database account name. */
export interface DbAccessGrantInput {
  connectionId: string;
  level: DbAccessLevel | null;
  /** The database account name proposed to the person (never a password). Users and invitations only. */
  sqlUsername?: string | null;
  /** Invitations only: create that account on the database when the invitation is accepted. */
  createAccount?: boolean;
}

export interface DbAccessGrant {
  connectionId: string;
  connectionName: string;
  level: DbAccessLevel | null;
  sqlUsername: string | null;
}

/** A level a user holds through one of their teams. */
export interface InheritedDbAccess {
  connectionId: string;
  connectionName: string;
  level: DbAccessLevel;
  teamId: string;
  teamName: string;
}

/** A user's own grants and those their teams give them — what Admin → Utilisateurs shows. */
export interface UserDbAccess {
  grants: DbAccessGrant[];
  inherited: InheritedDbAccess[];
}

/** The connections a user may query, with the highest level they hold on each. */
export interface MyDbAccess {
  connections: { connectionId: string; level: DbAccessLevel }[];
}

/** What an invitation gives the account once it is accepted. */
export interface InvitationGrants {
  teamIds: string[];
  databases: DbAccessGrantInput[];
}
