import mysql from "mysql2/promise";
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
import { ApiError } from "../../../shared/errors.js";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { mysqlPoolConfig } from "../../connections/drivers/mysql.js";
import { assertReadOnlyStatement } from "../sqlGuard.js";
import {
  MASK,
  checkedPrivileges,
  plain,
  quoteBacktick as q,
  requireInteger,
  requireName,
  requirePassword,
  systemObject,
  toNumber,
  toResult,
  trimStatement,
  unsupported,
} from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

const SYSTEM_DATABASES = new Set(["mysql", "information_schema", "performance_schema", "sys"]);
const SYSTEM_ACCOUNTS = new Set(["mysql.sys", "mysql.session", "mysql.infoschema", "mariadb.sys"]);

const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "REFERENCES",
  "INDEX",
  "ALTER",
  "CREATE VIEW",
  "SHOW VIEW",
  "TRIGGER",
];
const DATABASE_PRIVILEGES = [
  "ALL PRIVILEGES",
  ...TABLE_PRIVILEGES,
  "CREATE TEMPORARY TABLES",
  "LOCK TABLES",
  "EXECUTE",
  "CREATE ROUTINE",
  "ALTER ROUTINE",
  "EVENT",
];
const PRIVILEGES: DbPrivilegeCatalog = {
  server: [
    ...DATABASE_PRIVILEGES,
    "RELOAD",
    "PROCESS",
    "SHOW DATABASES",
    "CREATE USER",
    "REPLICATION SLAVE",
    "REPLICATION CLIENT",
    "SUPER",
  ],
  database: DATABASE_PRIVILEGES,
  table: ["ALL PRIVILEGES", ...TABLE_PRIVILEGES],
};

/** MySQL string literal: backslash is an escape character there, unlike in standard SQL. */
function lit(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function account(principal: DbPrincipalRef): string {
  const name = requireName(principal.name, "principal");
  if (SYSTEM_ACCOUNTS.has(name)) throw systemObject(`account ${name}`);
  return `${lit(name)}@${lit(principal.host?.trim() || "%")}`;
}

/** Splits a `SHOW GRANTS` privilege list on commas that are not inside a column list. */
function splitPrivileges(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function unquote(ident: string): string {
  return ident.replace(/^[`'"]|[`'"]$/g, "").replace(/``/g, "`");
}

/**
 * One line of `SHOW GRANTS` — the only account-privilege view that reads the
 * same on MySQL 5.7, MySQL 8 and MariaDB, which is why it is parsed instead of
 * querying the (diverging) `mysql.*` grant tables.
 */
export function parseGrantLine(line: string): { grant?: DbGrant; role?: string } {
  const privileged = /^GRANT (.+?) ON (?:(?:TABLE|FUNCTION|PROCEDURE) )?(.+?) TO /i.exec(line);
  if (!privileged) {
    const role = /^GRANT (.+?) TO /i.exec(line);
    if (!role) return {};
    // GRANT `r1`@`%`,`r2`@`%` TO ... (MySQL 8) or GRANT r1 TO ... (MariaDB)
    return {
      role: role[1]
        .split(",")
        .map((r) => unquote(r.trim().split("@")[0]))
        .join(", "),
    };
  }
  const privileges = splitPrivileges(privileged[1]).map((p) => p.toUpperCase());
  const grantable = /WITH GRANT OPTION/i.test(line);
  const [left, right] = privileged[2].split(".");
  if (left === "*" && right === "*") return { grant: { scope: "server", privileges, grantable } };
  if (right === "*") return { grant: { scope: "database", database: unquote(left), privileges, grantable } };
  return { grant: { scope: "table", database: unquote(left), table: unquote(right ?? ""), privileges, grantable } };
}

/**
 * MySQL and MariaDB. A "database" and a "schema" are the same thing here, so
 * there is no schema level: tables are addressed as `database`.`table`.
 */
export class MysqlAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: true,
    schemas: false,
    users: true,
    sessions: true,
    dropDatabase: true,
    principalLevels: false,
    principalHost: true,
  };

  private pool: mysql.Pool;
  private defaultDatabase: string | undefined;

  constructor(config: DriverConnectionConfig) {
    this.defaultDatabase = config.database || undefined;
    this.pool = mysql.createPool({ ...mysqlPoolConfig(config), connectionLimit: 2, connectTimeout: 5000 });
  }

  private async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params);
    return rows as T[];
  }

  private async currentDatabase(database?: string): Promise<string> {
    if (database) return requireName(database, "database");
    if (this.defaultDatabase) return this.defaultDatabase;
    const [row] = await this.rows<{ db: string | null }>("SELECT DATABASE() AS db");
    if (!row?.db) throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "a database is required" });
    return row.db;
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const rows = await this.rows<{ name: string; size: string | null }>(
      `SELECT s.SCHEMA_NAME AS name,
              (SELECT SUM(t.DATA_LENGTH + t.INDEX_LENGTH) FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME) AS size
         FROM information_schema.SCHEMATA s ORDER BY s.SCHEMA_NAME`,
    );
    return rows.map((r) => ({
      name: r.name,
      system: SYSTEM_DATABASES.has(r.name.toLowerCase()),
      sizeBytes: toNumber(r.size),
    }));
  }

  async listSchemas(): Promise<DbAdminSchema[]> {
    return [];
  }

  async listTables(database?: string): Promise<DbAdminTable[]> {
    const rows = await this.rows<{ name: string; type: string; est: string | null; size: string | null }>(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS est, DATA_LENGTH + INDEX_LENGTH AS size
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [await this.currentDatabase(database)],
    );
    return rows.map((r) => {
      const isView = r.type.toUpperCase().includes("VIEW");
      return {
        schema: null,
        name: r.name,
        kind: isView ? "view" : "table",
        rowEstimate: isView ? null : toNumber(r.est),
        sizeBytes: toNumber(r.size),
      };
    });
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const database = await this.currentDatabase(ref.database);
    const table = requireName(ref.table, "table");
    const columns = await this.rows<{
      name: string;
      type: string;
      nullable: string;
      def: string | null;
      col_key: string;
    }>(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, COLUMN_KEY AS col_key
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [database, table],
    );
    const indexRows = await this.rows<{ name: string; non_unique: number; col: string }>(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS col
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [database, table],
    );
    const constraintRows = await this.rows<{
      name: string;
      type: string;
      col: string | null;
      ref_table: string | null;
      ref_col: string | null;
    }>(
      `SELECT tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS type, k.COLUMN_NAME AS col,
              k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_col
         FROM information_schema.TABLE_CONSTRAINTS tc
         LEFT JOIN information_schema.KEY_COLUMN_USAGE k
           ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.TABLE_NAME = tc.TABLE_NAME AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? ORDER BY tc.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [database, table],
    );

    const indexes = new Map<string, { name: string; columns: string[]; unique: boolean; primary: boolean }>();
    for (const r of indexRows) {
      const index = indexes.get(r.name) ?? {
        name: r.name,
        columns: [],
        unique: Number(r.non_unique) === 0,
        primary: r.name === "PRIMARY",
      };
      index.columns.push(r.col);
      indexes.set(r.name, index);
    }
    const constraints = new Map<
      string,
      { name: string; type: string; cols: string[]; refTable: string | null; refCols: string[] }
    >();
    for (const r of constraintRows) {
      const key = `${r.type}:${r.name}`;
      const c = constraints.get(key) ?? { name: r.name, type: r.type, cols: [], refTable: r.ref_table, refCols: [] };
      if (r.col) c.cols.push(r.col);
      if (r.ref_col) c.refCols.push(r.ref_col);
      constraints.set(key, c);
    }
    return {
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable === "YES",
        defaultValue: c.def,
        primaryKey: c.col_key === "PRI",
      })),
      indexes: [...indexes.values()],
      constraints: [...constraints.values()].map((c) => ({
        name: c.name,
        type: c.type,
        definition: c.refTable
          ? `(${c.cols.join(", ")}) → ${c.refTable}(${c.refCols.join(", ")})`
          : `(${c.cols.join(", ")})`,
      })),
    };
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const target = `${q(await this.currentDatabase(ref.database))}.${q(requireName(ref.table, "table"))}`;
    const startedAt = Date.now();
    const [rows, fields] = await this.pool.query({
      sql: `SELECT * FROM ${target} LIMIT ${page.limit + 1} OFFSET ${page.offset}`,
      rowsAsArray: true,
    });
    return toResult(
      (fields as mysql.FieldPacket[]).map((f) => f.name),
      rows as unknown[][],
      page.limit,
      startedAt,
    );
  }

  async runQuery(sql: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const statement = trimStatement(sql);
    if (options.readOnly) assertReadOnlyStatement(statement, "mysql");
    const startedAt = Date.now();
    const conn = await this.pool.getConnection();
    let destroyed = false;
    try {
      if (options.database) await conn.query(`USE ${q(requireName(options.database, "database"))}`);
      // The server-side limit has a different name on MySQL and on MariaDB; the driver-side `timeout` below covers both.
      await conn
        .query(`SET SESSION MAX_EXECUTION_TIME = ${Math.round(options.timeoutMs)}`)
        .catch(() =>
          conn.query(`SET SESSION max_statement_time = ${Math.ceil(options.timeoutMs / 1000)}`).catch(() => {}),
        );
      if (options.readOnly) await conn.query("START TRANSACTION READ ONLY");

      // Streamed rather than awaited: the result of `SELECT * FROM huge_table`
      // must not be buffered whole just to keep its first rows.
      const columns: string[] = [];
      const rows: unknown[][] = [];
      let affected = 0;
      await new Promise<void>((resolve, reject) => {
        // `.connection` is the callback-style connection underneath the promise wrapper; its `query` returns an emitter.
        const core = conn.connection as unknown as { query(options: mysql.QueryOptions): NodeJS.EventEmitter };
        const query = core.query({ sql: statement, rowsAsArray: true, timeout: options.timeoutMs });
        query.on("error", reject);
        query.on("fields", (fields: mysql.FieldPacket[] | undefined) => {
          if (fields && columns.length === 0) columns.push(...fields.map((f) => f.name));
        });
        query.on("result", (row: unknown) => {
          if (Array.isArray(row)) {
            rows.push(row);
            if (rows.length > options.maxRows && !destroyed) {
              destroyed = true;
              conn.destroy();
              resolve();
            }
          } else affected = Number((row as { affectedRows?: number }).affectedRows ?? 0);
        });
        query.on("end", () => resolve());
      });
      return toResult(columns, rows, options.maxRows, startedAt, affected);
    } finally {
      if (!destroyed) {
        if (options.readOnly) await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
    }
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    const database = requireName(ref.database ?? this.defaultDatabase, "database");
    if (SYSTEM_DATABASES.has(database.toLowerCase())) throw systemObject(`database ${database}`);
    if (kind === "database") return [plain(`DROP DATABASE ${q(database)}`)];
    const target = `${q(database)}.${q(requireName(ref.table, "table"))}`;
    if (kind === "column") return [plain(`ALTER TABLE ${target} DROP COLUMN ${q(requireName(ref.column, "column"))}`)];
    return [plain(`DROP ${kind === "view" ? "VIEW" : "TABLE"} ${target}`)];
  }

  privilegeCatalog(): DbPrivilegeCatalog {
    return PRIVILEGES;
  }

  async listPrincipals(): Promise<DbPrincipal[]> {
    // `SELECT *`: the columns differ between MySQL (account_locked) and MariaDB (is_role), and both lack the other's.
    const rows = await this.rows<Record<string, unknown>>("SELECT * FROM mysql.user ORDER BY User, Host");
    const memberships = new Map<string, string[]>();
    const addMember = (user: string, host: string, role: string) => {
      const key = `${user}@${host}`;
      memberships.set(key, [...(memberships.get(key) ?? []), role]);
    };
    await this.rows<{ FROM_USER: string; TO_USER: string; TO_HOST: string }>(
      "SELECT FROM_USER, TO_USER, TO_HOST FROM mysql.role_edges",
    )
      .then((edges) => edges.forEach((e) => addMember(e.TO_USER, e.TO_HOST, e.FROM_USER)))
      .catch(() => {});
    await this.rows<{ User: string; Host: string; Role: string }>("SELECT User, Host, Role FROM mysql.roles_mapping")
      .then((edges) => edges.forEach((e) => addMember(e.User, e.Host, e.Role)))
      .catch(() => {});

    return rows.map((r) => {
      const name = String(r.User ?? r.user ?? "");
      const host = String(r.Host ?? r.host ?? "");
      const isRole = r.is_role === "Y";
      const locked = r.account_locked === "Y";
      return {
        name,
        host: isRole ? undefined : host,
        kind: isRole ? "role" : "user",
        canLogin: !isRole && !locked,
        locked,
        superuser: r.Super_priv === "Y",
        system: SYSTEM_ACCOUNTS.has(name),
        memberOf: memberships.get(`${name}@${host}`) ?? [],
      };
    });
  }

  async listGrants(principal: DbPrincipalRef): Promise<DbGrant[]> {
    const name = requireName(principal.name, "principal");
    const target =
      principal.kind === "role" && !principal.host ? lit(name) : `${lit(name)}@${lit(principal.host?.trim() || "%")}`;
    const rows = await this.rows<Record<string, string>>(`SHOW GRANTS FOR ${target}`);
    const grants: DbGrant[] = [];
    for (const row of rows) {
      const { grant } = parseGrantLine(String(Object.values(row)[0] ?? ""));
      // `USAGE` is MySQL's spelling of "no privileges" — it is on every account and carries no information.
      if (grant && !(grant.privileges.length === 1 && grant.privileges[0] === "USAGE")) grants.push(grant);
    }
    return grants;
  }

  userStatements(action: DbUserAction): AdminStatement[] {
    const isRole = action.principal.kind === "role";
    const who =
      isRole && !action.principal.host
        ? lit(requireName(action.principal.name, "principal"))
        : account(action.principal);

    switch (action.type) {
      case "create": {
        if (isRole) return [plain(`CREATE ROLE ${who}`)];
        const password = requirePassword(action.password);
        const statements: AdminStatement[] = [
          {
            sql: `CREATE USER ${who} IDENTIFIED BY ${lit(password)}`,
            display: `CREATE USER ${who} IDENTIFIED BY '${MASK}'`,
          },
        ];
        for (const role of action.roles ?? [])
          statements.push(plain(`GRANT ${lit(requireName(role, "role"))} TO ${who}`));
        return statements;
      }
      case "drop":
        return [plain(`DROP ${isRole ? "ROLE" : "USER"} ${who}`)];
      case "password": {
        const password = requirePassword(action.password);
        return [
          {
            sql: `ALTER USER ${who} IDENTIFIED BY ${lit(password)}`,
            display: `ALTER USER ${who} IDENTIFIED BY '${MASK}'`,
          },
        ];
      }
      case "lock":
        return [plain(`ALTER USER ${who} ACCOUNT ${action.locked ? "LOCK" : "UNLOCK"}`)];
      case "grantRole":
        return [plain(`GRANT ${lit(requireName(action.role, "role"))} TO ${who}`)];
      case "revokeRole":
        return [plain(`REVOKE ${lit(requireName(action.role, "role"))} FROM ${who}`)];
      case "grant":
      case "revoke": {
        const privileges = checkedPrivileges(PRIVILEGES, action.scope, action.privileges).join(", ");
        const target = action.target ?? {};
        let object: string;
        if (action.scope === "server") object = "*.*";
        else if (action.scope === "database") object = `${q(requireName(target.database, "database"))}.*`;
        else if (action.scope === "table") {
          object = `${q(requireName(target.database, "database"))}.${q(requireName(target.table, "table"))}`;
        } else throw unsupported("schema-level privileges");
        return action.type === "grant"
          ? [plain(`GRANT ${privileges} ON ${object} TO ${who}${action.withGrantOption ? " WITH GRANT OPTION" : ""}`)]
          : [plain(`REVOKE ${privileges} ON ${object} FROM ${who}`)];
      }
    }
  }

  async listSessions(): Promise<DbAdminSession[]> {
    const rows = await this.rows<{
      ID: number;
      USER: string | null;
      HOST: string | null;
      DB: string | null;
      COMMAND: string | null;
      TIME: number | null;
      STATE: string | null;
      INFO: string | null;
    }>(
      `SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO FROM information_schema.PROCESSLIST
        WHERE ID <> CONNECTION_ID() ORDER BY TIME DESC`,
    );
    return rows.map((r) => ({
      id: String(r.ID),
      user: r.USER,
      database: r.DB,
      client: r.HOST,
      state: [r.COMMAND, r.STATE].filter(Boolean).join(" — ") || null,
      query: r.INFO ? String(r.INFO).slice(0, 2000) : null,
      durationSeconds: toNumber(r.TIME),
    }));
  }

  async listBlocking(): Promise<DbBlocking[]> {
    // The `sys` schema may be missing or unreadable: then nothing can be said.
    const rows = await this.rows<{ blocked: string | number; blocker: string | number }>(
      "SELECT waiting_pid AS blocked, blocking_pid AS blocker FROM sys.innodb_lock_waits",
    ).catch(() => []);
    return rows.map((r) => ({ blocked: String(r.blocked), blocker: String(r.blocker) }));
  }

  async readCounters(): Promise<DbServerCounters> {
    const rows = await this.rows<{ Variable_name: string; Value: string }>(
      "SHOW GLOBAL STATUS WHERE Variable_name IN ('Questions', 'Bytes_sent', 'Bytes_received')",
    );
    const value = (name: string) => toNumber(rows.find((r) => r.Variable_name === name)?.Value);
    return {
      queries: value("Questions"),
      queriesKind: "statements",
      bytesOut: value("Bytes_sent"),
      bytesIn: value("Bytes_received"),
      rows: null,
    };
  }

  killSessionStatements(id: string): AdminStatement[] {
    return [plain(`KILL ${requireInteger(id, "session id")}`)];
  }

  ownPasswordStatements(password: string): AdminStatement[] {
    return [
      {
        sql: `ALTER USER CURRENT_USER() IDENTIFIED BY ${lit(requirePassword(password))}`,
        display: `ALTER USER CURRENT_USER() IDENTIFIED BY '${MASK}'`,
      },
    ];
  }

  async execute(statements: AdminStatement[], database?: string): Promise<void> {
    // No transaction: MySQL commits implicitly around every DDL and account statement anyway.
    const conn = await this.pool.getConnection();
    try {
      if (database) await conn.query(`USE ${q(requireName(database, "database"))}`);
      for (const statement of statements) await conn.query(statement.sql);
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => {});
  }
}
