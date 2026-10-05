import sql from "mssql";
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
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { mssqlPoolConfig } from "../../connections/drivers/mssql.js";
import { assertReadOnlyStatement } from "../sqlGuard.js";
import {
  MASK,
  checkedPrivileges,
  optionalName,
  plain,
  quoteBracket as q,
  requireInteger,
  requireName,
  requirePassword,
  systemObject,
  toNumber,
  toResult,
  unsupported,
} from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

const SYSTEM_DATABASES = new Set(["master", "tempdb", "model", "msdb"]);
const SYSTEM_SCHEMAS = new Set(["sys", "INFORMATION_SCHEMA", "guest"]);
const SYSTEM_PRINCIPALS = new Set(["sa", "public", "dbo", "guest", "sys", "INFORMATION_SCHEMA"]);

const OBJECT_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES", "ALTER", "CONTROL", "VIEW DEFINITION"];
const PRIVILEGES: DbPrivilegeCatalog = {
  server: [
    "CONNECT SQL",
    "VIEW SERVER STATE",
    "VIEW ANY DATABASE",
    "VIEW ANY DEFINITION",
    "ALTER ANY LOGIN",
    "ALTER ANY DATABASE",
    "CREATE ANY DATABASE",
    "CONTROL SERVER",
  ],
  database: [
    "CONNECT",
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "EXECUTE",
    "ALTER",
    "CONTROL",
    "CREATE TABLE",
    "CREATE VIEW",
    "CREATE PROCEDURE",
    "VIEW DEFINITION",
  ],
  schema: [...OBJECT_PRIVILEGES, "EXECUTE"],
  table: OBJECT_PRIVILEGES,
};

/** N-prefixed so a non-ASCII password survives whatever the server's code page is. */
function nlit(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

function isSystemPrincipal(name: string): boolean {
  return SYSTEM_PRINCIPALS.has(name) || name.startsWith("##") || name.startsWith("db_") || name.startsWith("NT ");
}

/**
 * SQL Server. Accounts exist at two levels — a *login* on the server, and a
 * *user* mapped to it inside each database — so every principal call takes an
 * optional database: none means the server level. A pool is opened per
 * database on demand, so catalog functions (`SCHEMA_NAME`, `OBJECT_NAME`)
 * resolve in the database being looked at.
 */
export class MssqlAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: true,
    schemas: true,
    users: true,
    sessions: true,
    dropDatabase: true,
    principalLevels: true,
    principalHost: false,
  };

  private pools = new Map<string, Promise<sql.ConnectionPool>>();

  constructor(private config: DriverConnectionConfig) {}

  private pool(database?: string): Promise<sql.ConnectionPool> {
    const key = database ?? "";
    let existing = this.pools.get(key);
    if (!existing) {
      const pool = new sql.ConnectionPool({ ...mssqlPoolConfig(this.config, database), pool: { max: 2, min: 0 } });
      pool.on("error", () => {});
      existing = pool.connect();
      this.pools.set(key, existing);
      // A failed connect (the database doesn't exist yet, say) must not be remembered for the next call.
      existing.catch(() => this.pools.delete(key));
    }
    return existing;
  }

  private async rows<T>(text: string, params: Record<string, unknown> = {}, database?: string): Promise<T[]> {
    const request = (await this.pool(database)).request();
    for (const [name, value] of Object.entries(params)) request.input(name, value);
    return (await request.query(text)).recordset as T[];
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const rows = await this.rows<{ name: string; database_id: number; size: string | null }>(
      `SELECT d.name, d.database_id,
              (SELECT SUM(CAST(f.size AS bigint)) * 8192 FROM sys.master_files f WHERE f.database_id = d.database_id) AS size
         FROM sys.databases d ORDER BY d.name`,
    ).catch(() =>
      // `sys.master_files` needs a server permission a database-level login doesn't have.
      this.rows<{ name: string; database_id: number; size: null }>(
        "SELECT name, database_id, NULL AS size FROM sys.databases ORDER BY name",
      ),
    );
    return rows.map((r) => ({ name: r.name, system: r.database_id <= 4, sizeBytes: toNumber(r.size) }));
  }

  async listSchemas(database?: string): Promise<DbAdminSchema[]> {
    const rows = await this.rows<{ name: string }>("SELECT name FROM sys.schemas ORDER BY name", {}, database);
    return rows.map((r) => ({ name: r.name, system: SYSTEM_SCHEMAS.has(r.name) || r.name.startsWith("db_") }));
  }

  async listTables(database?: string, schema?: string): Promise<DbAdminTable[]> {
    const rows = await this.rows<{
      schema: string;
      name: string;
      type: string;
      est: string | null;
      size: string | null;
    }>(
      `SELECT s.name AS [schema], o.name, o.type,
              (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS est,
              (SELECT SUM(a.total_pages) * 8192 FROM sys.partitions p
                 JOIN sys.allocation_units a ON a.container_id = p.partition_id WHERE p.object_id = o.object_id) AS size
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0 AND (@schema IS NULL OR s.name = @schema)
        ORDER BY s.name, o.name`,
      { schema: schema ?? null },
      database,
    );
    return rows.map((r) => {
      const isView = r.type.trim() === "V";
      return {
        schema: r.schema,
        name: r.name,
        kind: isView ? "view" : "table",
        rowEstimate: isView ? null : toNumber(r.est),
        sizeBytes: isView ? null : toNumber(r.size),
      };
    });
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const params = { schema: requireName(ref.schema ?? "dbo", "schema"), table: requireName(ref.table, "table") };
    const target = "OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table))";
    const columns = await this.rows<{
      name: string;
      type: string;
      len: number;
      prec: number;
      scale: number;
      nullable: boolean;
      def: string | null;
      pk: number;
    }>(
      `SELECT c.name, TYPE_NAME(c.user_type_id) AS type, c.max_length AS len, c.precision AS prec, c.scale,
              c.is_nullable AS nullable, OBJECT_DEFINITION(c.default_object_id) AS def,
              (SELECT COUNT(*) FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                WHERE i.object_id = c.object_id AND i.is_primary_key = 1 AND ic.column_id = c.column_id) AS pk
         FROM sys.columns c WHERE c.object_id = ${target} ORDER BY c.column_id`,
      params,
      ref.database,
    );
    const indexRows = await this.rows<{ name: string; uniq: boolean; prim: boolean; col: string }>(
      `SELECT i.name, i.is_unique AS uniq, i.is_primary_key AS prim, c.name AS col
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE i.object_id = ${target} AND i.name IS NOT NULL ORDER BY i.name, ic.key_ordinal`,
      params,
      ref.database,
    );
    const constraints = await this.rows<{ name: string; type: string; def: string | null }>(
      `SELECT name, 'FOREIGN KEY' AS type, '→ ' + OBJECT_SCHEMA_NAME(referenced_object_id) + '.' + OBJECT_NAME(referenced_object_id) AS def
         FROM sys.foreign_keys WHERE parent_object_id = ${target}
       UNION ALL
       SELECT name, 'CHECK', definition FROM sys.check_constraints WHERE parent_object_id = ${target}
       UNION ALL
       SELECT name, CASE type WHEN 'PK' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END, NULL FROM sys.key_constraints WHERE parent_object_id = ${target}
       ORDER BY 1`,
      params,
      ref.database,
    );
    const typeOf = (c: (typeof columns)[number]): string => {
      const type = c.type ?? "?";
      if (/^n?(var)?char$|^(var)?binary$/i.test(type)) {
        const chars = c.len === -1 ? "max" : String(/^n/i.test(type) ? c.len / 2 : c.len);
        return `${type}(${chars})`;
      }
      if (/^(decimal|numeric)$/i.test(type)) return `${type}(${c.prec},${c.scale})`;
      return type;
    };
    const indexes = new Map<string, { name: string; columns: string[]; unique: boolean; primary: boolean }>();
    for (const r of indexRows) {
      const index = indexes.get(r.name) ?? {
        name: r.name,
        columns: [],
        unique: Boolean(r.uniq),
        primary: Boolean(r.prim),
      };
      index.columns.push(r.col);
      indexes.set(r.name, index);
    }
    return {
      columns: columns.map((c) => ({
        name: c.name,
        type: typeOf(c),
        nullable: Boolean(c.nullable),
        defaultValue: c.def,
        primaryKey: c.pk > 0,
      })),
      indexes: [...indexes.values()],
      constraints: constraints.map((c) => ({ name: c.name, type: c.type, definition: c.def ?? "" })),
    };
  }

  /** Streams a batch, keeping at most `maxRows + 1` rows and cancelling the request past that. */
  private async stream(
    text: string,
    database: string | undefined,
    maxRows: number,
    timeoutMs?: number,
  ): Promise<DbAdminQueryResult> {
    const startedAt = Date.now();
    const request = (await this.pool(database)).request() as sql.Request & { arrayRowMode: boolean; timeout?: number };
    request.stream = true;
    request.arrayRowMode = true;
    if (timeoutMs) request.timeout = timeoutMs;
    let columns: string[] = [];
    let rows: unknown[][] = [];
    let affected = 0;
    let cancelled = false;
    await new Promise<void>((resolve, reject) => {
      request.on("recordset", (meta: unknown) => {
        // A batch can return several result sets; the last one is what is shown.
        const list = Array.isArray(meta) ? meta : Object.values(meta as Record<string, { name: string }>);
        columns = (list as { name: string }[]).map((c) => c.name);
        rows = [];
      });
      request.on("row", (row: unknown[]) => {
        if (cancelled) return;
        rows.push(row);
        if (rows.length > maxRows) {
          cancelled = true;
          request.cancel();
        }
      });
      request.on("error", (err: Error) => (cancelled ? resolve() : reject(err)));
      request.on("done", (result: { rowsAffected?: number[] }) => {
        affected = (result?.rowsAffected ?? []).reduce((sum, n) => sum + n, 0);
        resolve();
      });
      request.query(text);
    });
    return toResult(columns, rows, maxRows, startedAt, affected);
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const target = `${q(requireName(ref.schema ?? "dbo", "schema"))}.${q(requireName(ref.table, "table"))}`;
    return this.stream(
      `SELECT * FROM ${target} ORDER BY (SELECT NULL) OFFSET ${page.offset} ROWS FETCH NEXT ${page.limit + 1} ROWS ONLY`,
      ref.database,
      page.limit,
    );
  }

  async runQuery(text: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    // No read-only transaction exists on SQL Server: the statement check is the whole guard here.
    if (options.readOnly) assertReadOnlyStatement(text, "mssql");
    return this.stream(text, optionalName(options.database, "database"), options.maxRows, options.timeoutMs);
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    if (kind === "database") {
      const database = requireName(ref.database, "database");
      if (SYSTEM_DATABASES.has(database.toLowerCase())) throw systemObject(`database ${database}`);
      return [plain(`DROP DATABASE ${q(database)}`)];
    }
    const schema = requireName(ref.schema ?? "dbo", "schema");
    if (SYSTEM_SCHEMAS.has(schema)) throw systemObject(`schema ${schema}`);
    const target = `${q(schema)}.${q(requireName(ref.table, "table"))}`;
    if (kind === "column") return [plain(`ALTER TABLE ${target} DROP COLUMN ${q(requireName(ref.column, "column"))}`)];
    return [plain(`DROP ${kind === "view" ? "VIEW" : "TABLE"} ${target}`)];
  }

  privilegeCatalog(): DbPrivilegeCatalog {
    return PRIVILEGES;
  }

  async listPrincipals(database?: string): Promise<DbPrincipal[]> {
    if (!database) {
      const rows = await this.rows<{
        name: string;
        type: string;
        disabled: boolean;
        fixed: boolean;
        sysadmin: number;
        roles: string | null;
      }>(
        `SELECT p.name, p.type, p.is_disabled AS disabled, p.is_fixed_role AS fixed, ISNULL(IS_SRVROLEMEMBER('sysadmin', p.name), 0) AS sysadmin,
                (SELECT STRING_AGG(r.name, ',') FROM sys.server_role_members m
                   JOIN sys.server_principals r ON r.principal_id = m.role_principal_id
                  WHERE m.member_principal_id = p.principal_id) AS roles
           FROM sys.server_principals p WHERE p.type IN ('S', 'U', 'G', 'R') ORDER BY p.name`,
      );
      return rows.map((r) => {
        const isRole = r.type.trim() === "R";
        return {
          name: r.name,
          kind: isRole ? "role" : "user",
          canLogin: !isRole && !r.disabled,
          locked: !isRole && Boolean(r.disabled),
          superuser: r.sysadmin === 1,
          system: isSystemPrincipal(r.name) || Boolean(r.fixed),
          memberOf: r.roles ? r.roles.split(",") : [],
        };
      });
    }
    const rows = await this.rows<{ name: string; type: string; fixed: boolean; roles: string | null }>(
      `SELECT p.name, p.type, p.is_fixed_role AS fixed,
              (SELECT STRING_AGG(r.name, ',') FROM sys.database_role_members m
                 JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
                WHERE m.member_principal_id = p.principal_id) AS roles
         FROM sys.database_principals p WHERE p.type IN ('S', 'U', 'G', 'R') ORDER BY p.name`,
      {},
      database,
    );
    return rows.map((r) => {
      const isRole = r.type.trim() === "R";
      const memberOf = r.roles ? r.roles.split(",") : [];
      return {
        name: r.name,
        kind: isRole ? "role" : "user",
        canLogin: !isRole,
        locked: false,
        superuser: memberOf.includes("db_owner") || r.name === "dbo",
        system: isSystemPrincipal(r.name) || Boolean(r.fixed),
        memberOf,
      };
    });
  }

  async listGrants(principal: DbPrincipalRef): Promise<DbGrant[]> {
    const name = requireName(principal.name, "principal");
    const database = optionalName(principal.database, "database");
    const grants: DbGrant[] = [];
    const push = (grant: Omit<DbGrant, "privileges" | "grantable" | "denied">, privilege: string, state: string) => {
      const grantable = state.trim() === "W";
      const denied = state.trim() === "D";
      const existing = grants.find(
        (g) =>
          g.scope === grant.scope &&
          g.schema === grant.schema &&
          g.table === grant.table &&
          g.grantable === grantable &&
          Boolean(g.denied) === denied,
      );
      if (existing) existing.privileges.push(privilege);
      else grants.push({ ...grant, privileges: [privilege], grantable, ...(denied ? { denied: true } : {}) });
    };

    if (!database) {
      const rows = await this.rows<{ permission: string; state: string }>(
        `SELECT pe.permission_name AS permission, pe.state FROM sys.server_permissions pe
           JOIN sys.server_principals p ON p.principal_id = pe.grantee_principal_id
          WHERE p.name = @name AND pe.class = 100 ORDER BY 1`,
        { name },
      );
      for (const r of rows) push({ scope: "server" }, r.permission, r.state);
      return grants;
    }

    const rows = await this.rows<{
      class: number;
      permission: string;
      state: string;
      schema: string | null;
      object: string | null;
    }>(
      `SELECT pe.class, pe.permission_name AS permission, pe.state,
              CASE pe.class WHEN 3 THEN SCHEMA_NAME(pe.major_id) WHEN 1 THEN OBJECT_SCHEMA_NAME(pe.major_id) END AS [schema],
              CASE pe.class WHEN 1 THEN OBJECT_NAME(pe.major_id) END AS object
         FROM sys.database_permissions pe
         JOIN sys.database_principals p ON p.principal_id = pe.grantee_principal_id
        WHERE p.name = @name AND pe.class IN (0, 1, 3) AND pe.minor_id = 0 ORDER BY pe.class, 4, 5, 2`,
      { name },
      database,
    );
    for (const r of rows) {
      if (r.class === 0) push({ scope: "database", database }, r.permission, r.state);
      else if (r.class === 3) push({ scope: "schema", database, schema: r.schema ?? undefined }, r.permission, r.state);
      else
        push(
          { scope: "table", database, schema: r.schema ?? undefined, table: r.object ?? undefined },
          r.permission,
          r.state,
        );
    }
    return grants;
  }

  userStatements(action: DbUserAction): AdminStatement[] {
    const name = requireName(action.principal.name, "principal");
    if (isSystemPrincipal(name)) throw systemObject(`principal ${name}`);
    const who = q(name);
    const inDatabase = Boolean(action.principal.database);
    const isRole = action.principal.kind === "role";

    switch (action.type) {
      case "create": {
        if (isRole) return [plain(inDatabase ? `CREATE ROLE ${who}` : `CREATE SERVER ROLE ${who}`)];
        const statements: AdminStatement[] = [];
        if (inDatabase) {
          // A database user is the mapping of an existing server login of the same name.
          statements.push(plain(`CREATE USER ${who} FOR LOGIN ${who}`));
        } else {
          const password = requirePassword(action.password);
          statements.push({
            sql: `CREATE LOGIN ${who} WITH PASSWORD = ${nlit(password)}`,
            display: `CREATE LOGIN ${who} WITH PASSWORD = N'${MASK}'`,
          });
        }
        for (const role of action.roles ?? []) {
          statements.push(
            plain(`ALTER ${inDatabase ? "ROLE" : "SERVER ROLE"} ${q(requireName(role, "role"))} ADD MEMBER ${who}`),
          );
        }
        return statements;
      }
      case "drop":
        if (isRole) return [plain(inDatabase ? `DROP ROLE ${who}` : `DROP SERVER ROLE ${who}`)];
        return [plain(inDatabase ? `DROP USER ${who}` : `DROP LOGIN ${who}`)];
      case "password": {
        if (inDatabase) throw unsupported("changing a password at database level (it belongs to the server login)");
        const password = requirePassword(action.password);
        return [
          {
            sql: `ALTER LOGIN ${who} WITH PASSWORD = ${nlit(password)}`,
            display: `ALTER LOGIN ${who} WITH PASSWORD = N'${MASK}'`,
          },
        ];
      }
      case "lock":
        if (inDatabase) throw unsupported("disabling an account at database level (disable the server login)");
        return [plain(`ALTER LOGIN ${who} ${action.locked ? "DISABLE" : "ENABLE"}`)];
      case "grantRole":
      case "revokeRole": {
        const verb = action.type === "grantRole" ? "ADD" : "DROP";
        return [
          plain(
            `ALTER ${inDatabase ? "ROLE" : "SERVER ROLE"} ${q(requireName(action.role, "role"))} ${verb} MEMBER ${who}`,
          ),
        ];
      }
      case "grant":
      case "revoke": {
        const privileges = checkedPrivileges(PRIVILEGES, action.scope, action.privileges).join(", ");
        const target = action.target ?? {};
        let on = "";
        if (action.scope === "schema") on = ` ON SCHEMA::${q(requireName(target.schema, "schema"))}`;
        else if (action.scope === "table") {
          on = ` ON OBJECT::${q(requireName(target.schema ?? "dbo", "schema"))}.${q(requireName(target.table, "table"))}`;
        }
        return action.type === "grant"
          ? [plain(`GRANT ${privileges}${on} TO ${who}${action.withGrantOption ? " WITH GRANT OPTION" : ""}`)]
          : [plain(`REVOKE ${privileges}${on} FROM ${who} CASCADE`)];
      }
    }
  }

  async listBlocking(): Promise<DbBlocking[]> {
    const rows = await this.rows<{ blocked: number; blocker: number }>(
      "SELECT session_id AS blocked, blocking_session_id AS blocker FROM sys.dm_exec_requests WHERE blocking_session_id <> 0",
    ).catch(() => []);
    return rows.map((r) => ({ blocked: String(r.blocked), blocker: String(r.blocker) }));
  }

  async readCounters(): Promise<DbServerCounters> {
    // Needs VIEW SERVER STATE; without it the counters are simply unavailable. No cumulative byte totals exist.
    const rows = await this.rows<{ v: string | number }>(
      `SELECT cntr_value AS v FROM sys.dm_os_performance_counters
        WHERE counter_name LIKE 'Batch Requests/sec%' AND object_name LIKE '%SQL Statistics%'`,
    ).catch(() => []);
    return { queries: toNumber(rows[0]?.v), queriesKind: "batches", bytesOut: null, bytesIn: null, rows: null };
  }

  async listSessions(): Promise<DbAdminSession[]> {
    const rows = await this.rows<{
      id: number;
      login: string | null;
      db: string | null;
      host: string | null;
      status: string | null;
      text: string | null;
      seconds: number | null;
    }>(
      `SELECT s.session_id AS id, s.login_name AS login, DB_NAME(s.database_id) AS db, s.host_name AS host,
              COALESCE(r.status, s.status) AS status, t.text,
              DATEDIFF(SECOND, COALESCE(r.start_time, s.last_request_start_time), GETDATE()) AS seconds
         FROM sys.dm_exec_sessions s
         LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
         OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
        WHERE s.is_user_process = 1 AND s.session_id <> @@SPID ORDER BY s.session_id`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      user: r.login,
      database: r.db,
      client: r.host,
      state: r.status,
      query: r.text ? r.text.slice(0, 2000) : null,
      durationSeconds: r.seconds,
    }));
  }

  killSessionStatements(id: string): AdminStatement[] {
    return [plain(`KILL ${requireInteger(id, "session id")}`)];
  }

  async execute(statements: AdminStatement[], database?: string): Promise<void> {
    // No wrapping transaction: several of these (CREATE/DROP DATABASE, some
    // login changes) are refused inside one. `DROP DATABASE` runs from the
    // connection's own database, never from the one being dropped.
    const dropsDatabase = statements.some((s) => s.sql.startsWith("DROP DATABASE"));
    if (dropsDatabase) await this.closePools((key) => key !== "");
    const pool = await this.pool(dropsDatabase ? undefined : database);
    for (const statement of statements) await pool.request().batch(statement.sql);
  }

  /** Our own connections count as users of a database: they have to go before it can be dropped. */
  private async closePools(which: (key: string) => boolean): Promise<void> {
    const pending: Promise<sql.ConnectionPool>[] = [];
    for (const [key, pool] of this.pools) {
      if (!which(key)) continue;
      pending.push(pool);
      this.pools.delete(key);
    }
    await Promise.all(pending.map((p) => p.then((pool) => pool.close()).catch(() => {})));
  }

  async close(): Promise<void> {
    await this.closePools(() => true);
  }
}
