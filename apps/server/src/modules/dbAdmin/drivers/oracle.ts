import oracledb from "oracledb";
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
import { ApiError } from "../../../shared/errors.js";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { oraclePoolAttributes } from "../../connections/drivers/oracle.js";
import { assertReadOnlyStatement } from "../sqlGuard.js";
import {
  MASK,
  checkedPrivileges,
  plain,
  quoteDouble as q,
  requireName,
  requirePassword,
  systemObject,
  toNumber,
  toResult,
  trimStatement,
  unsupported,
} from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

const PRIVILEGES: DbPrivilegeCatalog = {
  server: [
    "CREATE SESSION",
    "CREATE TABLE",
    "CREATE VIEW",
    "CREATE SEQUENCE",
    "CREATE PROCEDURE",
    "CREATE TRIGGER",
    "CREATE SYNONYM",
    "UNLIMITED TABLESPACE",
    "SELECT ANY TABLE",
    "SELECT ANY DICTIONARY",
  ],
  table: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "INDEX", "REFERENCES"],
};

/**
 * Oracle account passwords are written as a quoted identifier, which has no
 * escape for the double quote itself — so that one character is refused
 * rather than risk it closing the quote.
 */
function passwordToken(value: unknown): string {
  const password = requirePassword(value);
  if (password.includes('"')) {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: 'an Oracle password cannot contain a double quote (")' });
  }
  return `"${password}"`;
}

/**
 * Oracle (one database per connection; a "schema" is a user's namespace). The
 * account views used here are the `DBA_*` ones, which need a DBA-level
 * connection — a plain user gets a clear ORA-00942 from the server instead.
 */
export class OracleAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: false,
    schemas: true,
    users: true,
    sessions: true,
    dropDatabase: false,
    principalLevels: false,
    principalHost: false,
  };

  private pool: Promise<oracledb.Pool>;
  /** The route layer checks the catalog's own `oracle_maintained` flag; this is the floor that needs no round trip. */
  private maintained = new Set(["SYS", "SYSTEM", "PUBLIC"]);

  constructor(config: DriverConnectionConfig) {
    this.pool = oracledb.createPool({ ...oraclePoolAttributes(config), poolMax: 2 });
  }

  private async withConnection<T>(fn: (conn: oracledb.Connection) => Promise<T>): Promise<T> {
    const conn = await (await this.pool).getConnection();
    try {
      return await fn(conn);
    } finally {
      await conn.close().catch(() => {});
    }
  }

  private rows<T>(text: string, binds: Record<string, unknown> = {}): Promise<T[]> {
    return this.withConnection(async (conn) => {
      const res = await conn.execute(text, binds as oracledb.BindParameters, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return (res.rows ?? []) as T[];
    });
  }

  private async schemaOrCurrent(schema?: string): Promise<string> {
    if (schema) return requireName(schema, "schema");
    const [row] = await this.rows<{ S: string }>("SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS S FROM dual");
    return row.S;
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const [row] = await this.rows<{ NAME: string }>("SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS NAME FROM dual");
    return [{ name: row?.NAME ?? "ORACLE", system: false, sizeBytes: null }];
  }

  async listSchemas(): Promise<DbAdminSchema[]> {
    const rows = await this.rows<{ USERNAME: string; ORACLE_MAINTAINED: string }>(
      "SELECT username, oracle_maintained FROM all_users ORDER BY username",
    );
    return rows.map((r) => ({ name: r.USERNAME, system: r.ORACLE_MAINTAINED === "Y" }));
  }

  async listTables(_database?: string, schema?: string): Promise<DbAdminTable[]> {
    const owner = await this.schemaOrCurrent(schema);
    const rows = await this.rows<{ NAME: string; KIND: string; EST: number | null }>(
      `SELECT table_name AS name, 'table' AS kind, num_rows AS est FROM all_tables WHERE owner = :owner
       UNION ALL
       SELECT view_name, 'view', NULL FROM all_views WHERE owner = :owner
       ORDER BY 1`,
      { owner },
    );
    return rows.map((r) => ({
      schema: owner,
      name: r.NAME,
      kind: r.KIND === "view" ? "view" : "table",
      rowEstimate: toNumber(r.EST),
      sizeBytes: null,
    }));
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const binds = { owner: await this.schemaOrCurrent(ref.schema), tbl: requireName(ref.table, "table") };
    const columns = await this.rows<{
      NAME: string;
      TYPE: string;
      LEN: number;
      PREC: number | null;
      SCALE: number | null;
      NULLABLE: string;
      DEF: string | null;
    }>(
      `SELECT column_name AS name, data_type AS type, char_length AS len, data_precision AS prec, data_scale AS scale,
              nullable, data_default AS def
         FROM all_tab_columns WHERE owner = :owner AND table_name = :tbl ORDER BY column_id`,
      binds,
    );
    const constraintRows = await this.rows<{
      NAME: string;
      TYPE: string;
      COL: string | null;
      COND: string | null;
      R_NAME: string | null;
    }>(
      `SELECT c.constraint_name AS name, c.constraint_type AS type, cc.column_name AS col, c.search_condition AS cond,
              c.r_constraint_name AS r_name
         FROM all_constraints c
         LEFT JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
        WHERE c.owner = :owner AND c.table_name = :tbl ORDER BY c.constraint_name, cc.position`,
      binds,
    );
    const indexRows = await this.rows<{ NAME: string; UNIQ: string; COL: string }>(
      `SELECT i.index_name AS name, i.uniqueness AS uniq, ic.column_name AS col
         FROM all_indexes i
         JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name
        WHERE i.table_owner = :owner AND i.table_name = :tbl ORDER BY i.index_name, ic.column_position`,
      binds,
    );

    const typeNames: Record<string, string> = { P: "PRIMARY KEY", R: "FOREIGN KEY", U: "UNIQUE", C: "CHECK" };
    const constraints = new Map<
      string,
      { name: string; type: string; cols: string[]; cond: string | null; ref: string | null }
    >();
    for (const r of constraintRows) {
      const c = constraints.get(r.NAME) ?? { name: r.NAME, type: r.TYPE, cols: [], cond: r.COND, ref: r.R_NAME };
      if (r.COL) c.cols.push(r.COL);
      constraints.set(r.NAME, c);
    }
    const primaryColumns = new Set([...constraints.values()].filter((c) => c.type === "P").flatMap((c) => c.cols));
    const primaryNames = new Set([...constraints.values()].filter((c) => c.type === "P").map((c) => c.name));
    const indexes = new Map<string, { name: string; columns: string[]; unique: boolean; primary: boolean }>();
    for (const r of indexRows) {
      const index = indexes.get(r.NAME) ?? {
        name: r.NAME,
        columns: [],
        unique: r.UNIQ === "UNIQUE",
        primary: primaryNames.has(r.NAME),
      };
      index.columns.push(r.COL);
      indexes.set(r.NAME, index);
    }
    const typeOf = (c: (typeof columns)[number]): string => {
      if (/CHAR/.test(c.TYPE) && c.LEN) return `${c.TYPE}(${c.LEN})`;
      if (c.TYPE === "NUMBER" && c.PREC !== null) return `NUMBER(${c.PREC}${c.SCALE ? `,${c.SCALE}` : ""})`;
      return c.TYPE;
    };
    return {
      columns: columns.map((c) => ({
        name: c.NAME,
        type: typeOf(c),
        nullable: c.NULLABLE === "Y",
        defaultValue: c.DEF === null || c.DEF === undefined ? null : String(c.DEF).trim(),
        primaryKey: primaryColumns.has(c.NAME),
      })),
      indexes: [...indexes.values()],
      constraints: [...constraints.values()].map((c) => ({
        name: c.name,
        type: typeNames[c.type] ?? c.type,
        definition: c.type === "C" ? (c.cond ?? "") : `(${c.cols.join(", ")})${c.ref ? ` → ${c.ref}` : ""}`,
      })),
    };
  }

  private async run(
    conn: oracledb.Connection,
    text: string,
    maxRows: number,
    startedAt: number,
    autoCommit: boolean,
  ): Promise<DbAdminQueryResult> {
    const res = await conn.execute(text, [], {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      maxRows: maxRows + 1,
      autoCommit,
    });
    const columns = (res.metaData ?? []).map((m) => m.name);
    return toResult(columns, (res.rows ?? []) as unknown[][], maxRows, startedAt, res.rowsAffected ?? 0);
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const target = `${q(await this.schemaOrCurrent(ref.schema))}.${q(requireName(ref.table, "table"))}`;
    const startedAt = Date.now();
    return this.withConnection((conn) =>
      this.run(
        conn,
        `SELECT * FROM ${target} OFFSET ${page.offset} ROWS FETCH NEXT ${page.limit + 1} ROWS ONLY`,
        page.limit,
        startedAt,
        false,
      ),
    );
  }

  async runQuery(sql: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const statement = trimStatement(sql);
    if (options.readOnly) assertReadOnlyStatement(statement, "oracle");
    const startedAt = Date.now();
    return this.withConnection(async (conn) => {
      conn.callTimeout = options.timeoutMs;
      if (!options.readOnly) return this.run(conn, statement, options.maxRows, startedAt, true);
      try {
        await conn.execute("SET TRANSACTION READ ONLY");
        return await this.run(conn, statement, options.maxRows, startedAt, false);
      } catch (err) {
        // A read-only transaction reads as of its start, and Oracle refuses that
        // (ORA-01466) for a table created or altered in the last few seconds —
        // exactly what someone does right after a CREATE TABLE. The statement has
        // already passed the read-only check and nothing is ever committed here,
        // so it is simply run again outside the snapshot.
        if (!(err instanceof Error) || !err.message.includes("ORA-01466")) throw err;
        await conn.rollback().catch(() => {});
        return await this.run(conn, statement, options.maxRows, startedAt, false);
      } finally {
        await conn.rollback().catch(() => {});
      }
    });
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    if (kind === "database") throw unsupported("dropping a database");
    const schema = requireName(ref.schema, "schema");
    if (this.maintained.has(schema)) throw systemObject(`schema ${schema}`);
    const target = `${q(schema)}.${q(requireName(ref.table, "table"))}`;
    if (kind === "column") return [plain(`ALTER TABLE ${target} DROP COLUMN ${q(requireName(ref.column, "column"))}`)];
    return [plain(`DROP ${kind === "view" ? "VIEW" : "TABLE"} ${target}`)];
  }

  privilegeCatalog(): DbPrivilegeCatalog {
    return PRIVILEGES;
  }

  async listPrincipals(): Promise<DbPrincipal[]> {
    const users = await this.rows<{ NAME: string; STATUS: string; MAINTAINED: string }>(
      "SELECT username AS name, account_status AS status, oracle_maintained AS maintained FROM dba_users ORDER BY username",
    );
    const roles = await this.rows<{ NAME: string; MAINTAINED: string }>(
      "SELECT role AS name, oracle_maintained AS maintained FROM dba_roles ORDER BY role",
    );
    const memberships = await this.rows<{ GRANTEE: string; GRANTED_ROLE: string }>(
      "SELECT grantee, granted_role FROM dba_role_privs",
    );
    const memberOf = (name: string) => memberships.filter((m) => m.GRANTEE === name).map((m) => m.GRANTED_ROLE);
    return [
      ...users.map((u) => {
        const roleNames = memberOf(u.NAME);
        const locked = u.STATUS.includes("LOCKED");
        return {
          name: u.NAME,
          kind: "user" as const,
          canLogin: !locked,
          locked,
          superuser: roleNames.includes("DBA"),
          system: u.MAINTAINED === "Y",
          memberOf: roleNames,
        };
      }),
      ...roles.map((r) => ({
        name: r.NAME,
        kind: "role" as const,
        canLogin: false,
        locked: false,
        superuser: r.NAME === "DBA",
        system: r.MAINTAINED === "Y",
        memberOf: memberOf(r.NAME),
      })),
    ];
  }

  async listGrants(principal: DbPrincipalRef): Promise<DbGrant[]> {
    const grantee = requireName(principal.name, "principal");
    const grants: DbGrant[] = [];
    const system = await this.rows<{ PRIVILEGE: string; ADMIN_OPTION: string }>(
      "SELECT privilege, admin_option FROM dba_sys_privs WHERE grantee = :grantee ORDER BY privilege",
      { grantee },
    );
    for (const grantable of [false, true]) {
      const privileges = system.filter((s) => (s.ADMIN_OPTION === "YES") === grantable).map((s) => s.PRIVILEGE);
      if (privileges.length > 0) grants.push({ scope: "server", privileges, grantable });
    }
    const objects = await this.rows<{ OWNER: string; TABLE_NAME: string; PRIVILEGE: string; GRANTABLE: string }>(
      "SELECT owner, table_name, privilege, grantable FROM dba_tab_privs WHERE grantee = :grantee ORDER BY owner, table_name, privilege",
      { grantee },
    );
    for (const o of objects) {
      const grantable = o.GRANTABLE === "YES";
      const existing = grants.find(
        (g) => g.scope === "table" && g.schema === o.OWNER && g.table === o.TABLE_NAME && g.grantable === grantable,
      );
      if (existing) existing.privileges.push(o.PRIVILEGE);
      else grants.push({ scope: "table", schema: o.OWNER, table: o.TABLE_NAME, privileges: [o.PRIVILEGE], grantable });
    }
    return grants;
  }

  userStatements(action: DbUserAction): AdminStatement[] {
    // Unquoted Oracle names fold to upper case; a new account is created that
    // way too, so it can be used later without quoting it everywhere.
    const name = requireName(
      action.type === "create" ? action.principal.name.toUpperCase() : action.principal.name,
      "principal",
    );
    if (this.maintained.has(name)) throw systemObject(`account ${name}`);
    const who = q(name);

    switch (action.type) {
      case "create": {
        if (action.principal.kind === "role") return [plain(`CREATE ROLE ${who}`)];
        const password = passwordToken(action.password);
        const statements: AdminStatement[] = [
          {
            sql: `CREATE USER ${who} IDENTIFIED BY ${password}`,
            display: `CREATE USER ${who} IDENTIFIED BY "${MASK}"`,
          },
        ];
        for (const role of action.roles ?? [])
          statements.push(plain(`GRANT ${q(requireName(role, "role"))} TO ${who}`));
        return statements;
      }
      case "drop":
        // No CASCADE: a user who still owns objects is refused by the server rather than taking their tables along.
        return [plain(`DROP ${action.principal.kind === "role" ? "ROLE" : "USER"} ${who}`)];
      case "password": {
        const password = passwordToken(action.password);
        return [
          { sql: `ALTER USER ${who} IDENTIFIED BY ${password}`, display: `ALTER USER ${who} IDENTIFIED BY "${MASK}"` },
        ];
      }
      case "lock":
        return [plain(`ALTER USER ${who} ACCOUNT ${action.locked ? "LOCK" : "UNLOCK"}`)];
      case "grantRole":
        return [plain(`GRANT ${q(requireName(action.role, "role"))} TO ${who}`)];
      case "revokeRole":
        return [plain(`REVOKE ${q(requireName(action.role, "role"))} FROM ${who}`)];
      case "grant":
      case "revoke": {
        const privileges = checkedPrivileges(PRIVILEGES, action.scope, action.privileges).join(", ");
        let on = "";
        if (action.scope === "table") {
          const target = action.target ?? {};
          on = ` ON ${q(requireName(target.schema, "schema"))}.${q(requireName(target.table, "table"))}`;
        }
        return action.type === "grant"
          ? [
              plain(
                `GRANT ${privileges}${on} TO ${who}${action.withGrantOption ? (on ? " WITH GRANT OPTION" : " WITH ADMIN OPTION") : ""}`,
              ),
            ]
          : [plain(`REVOKE ${privileges}${on} FROM ${who}`)];
      }
    }
  }

  async listSessions(): Promise<DbAdminSession[]> {
    const rows = await this.rows<{
      SID: number;
      SERIAL: number;
      USERNAME: string | null;
      MACHINE: string | null;
      STATUS: string | null;
      SQL_TEXT: string | null;
      SECONDS: number | null;
    }>(
      `SELECT s.sid, s.serial# AS serial, s.username, s.machine, s.status, q.sql_text, s.last_call_et AS seconds
         FROM v$session s LEFT JOIN v$sql q ON q.sql_id = s.sql_id AND q.child_number = s.sql_child_number
        WHERE s.type = 'USER' AND s.sid <> SYS_CONTEXT('USERENV', 'SID') ORDER BY s.sid`,
    );
    return rows.map((r) => ({
      id: `${r.SID},${r.SERIAL}`,
      user: r.USERNAME,
      database: null,
      client: r.MACHINE,
      state: r.STATUS,
      query: r.SQL_TEXT ? r.SQL_TEXT.slice(0, 2000) : null,
      durationSeconds: toNumber(r.SECONDS),
    }));
  }

  async listBlocking(): Promise<DbBlocking[]> {
    const rows = await this.rows<{ BLOCKED: number; BLOCKER: number }>(
      "SELECT sid AS blocked, blocking_session AS blocker FROM v$session WHERE blocking_session IS NOT NULL",
    ).catch(() => []);
    return rows.map((r) => ({ blocked: String(r.BLOCKED), blocker: String(r.BLOCKER) }));
  }

  async readCounters(): Promise<DbServerCounters> {
    const rows = await this.rows<{ NAME: string; VALUE: number | string }>(
      `SELECT name, value FROM v$sysstat
        WHERE name IN ('user calls', 'bytes sent via SQL*Net to client', 'bytes received via SQL*Net from client')`,
    ).catch(() => []);
    const value = (name: string) => toNumber(rows.find((r) => r.NAME === name)?.VALUE);
    return {
      queries: value("user calls"),
      queriesKind: "calls",
      bytesOut: value("bytes sent via SQL*Net to client"),
      bytesIn: value("bytes received via SQL*Net from client"),
      rows: null,
    };
  }

  killSessionStatements(id: string): AdminStatement[] {
    if (!/^\d+,\d+$/.test(id))
      throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "session id must be sid,serial#" });
    return [plain(`ALTER SYSTEM KILL SESSION '${id}' IMMEDIATE`)];
  }

  // Oracle has no "current user" in ALTER USER, and the name a session signed in with may differ
  // in case from the account's own: the statement is built from `USER`, on the server.
  ownPasswordStatements(password: string, currentPassword: string): AdminStatement[] {
    const clause = (next: string, current: string) => `IDENTIFIED BY ${next} REPLACE ${current}`;
    const inString = (text: string) => text.replace(/'/g, "''");
    const alter = (tail: string) => `BEGIN EXECUTE IMMEDIATE 'ALTER USER "' || USER || '" ${tail}'; END;`;
    return [
      {
        sql: alter(inString(clause(passwordToken(password), passwordToken(currentPassword)))),
        display: alter(clause(`"${MASK}"`, `"${MASK}"`)),
      },
    ];
  }

  async execute(statements: AdminStatement[]): Promise<void> {
    // Every one of these is DDL, which Oracle commits on its own.
    await this.withConnection(async (conn) => {
      for (const statement of statements) await conn.execute(statement.sql);
    });
  }

  async close(): Promise<void> {
    await (await this.pool.catch(() => null))?.close(0).catch(() => {});
  }
}
