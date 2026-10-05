import pg from "pg";
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
import { postgresPoolConfig } from "../../connections/drivers/postgres.js";
import { assertReadOnlyStatement, isRowReturningQuery } from "../sqlGuard.js";
import {
  MASK,
  checkedPrivileges,
  literal,
  optionalName,
  plain,
  quoteDouble as q,
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

const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);
const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema"]);

const PRIVILEGES: DbPrivilegeCatalog = {
  database: ["CONNECT", "CREATE", "TEMPORARY"],
  schema: ["USAGE", "CREATE"],
  table: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"],
};

/** `queryMode` is a real `pg` option (extended protocol even without parameters) that its typings don't list yet. */
function extended(text: string): pg.QueryArrayConfig {
  return { text, rowMode: "array", queryMode: "extended" } as pg.QueryArrayConfig;
}

function isSystemRole(name: string): boolean {
  return name.startsWith("pg_");
}

/**
 * PostgreSQL. A connection is bound to one database, so browsing another one
 * means another client — opened on demand and kept for the lifetime of this
 * driver (one HTTP request).
 */
export class PostgresAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: true,
    schemas: true,
    users: true,
    sessions: true,
    dropDatabase: true,
    principalLevels: false,
    principalHost: false,
  };

  private clients = new Map<string, Promise<pg.Client>>();

  constructor(private config: DriverConnectionConfig) {}

  private client(database?: string): Promise<pg.Client> {
    const key = database ?? "";
    let existing = this.clients.get(key);
    if (!existing) {
      const client = new pg.Client(postgresPoolConfig(this.config, database));
      // Without a listener an idle-connection error (the server going away
      // between two statements) would be an unhandled 'error' event.
      client.on("error", () => {});
      existing = client.connect().then(() => client);
      this.clients.set(key, existing);
      // A failed connect (the database doesn't exist yet, say) must not be remembered for the next call.
      existing.catch(() => this.clients.delete(key));
    }
    return existing;
  }

  private async rows<T>(sql: string, params: unknown[] = [], database?: string): Promise<T[]> {
    const client = await this.client(database);
    return (await client.query(sql, params)).rows as T[];
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    const rows = await this.rows<{ name: string; size: string | null }>(
      `SELECT datname AS name,
              CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) END AS size
         FROM pg_database WHERE datallowconn ORDER BY datname`,
    );
    return rows.map((r) => ({ name: r.name, system: SYSTEM_DATABASES.has(r.name), sizeBytes: toNumber(r.size) }));
  }

  async listSchemas(database?: string): Promise<DbAdminSchema[]> {
    const rows = await this.rows<{ name: string }>(
      `SELECT nspname AS name FROM pg_namespace WHERE nspname !~ '^pg_(temp|toast)' ORDER BY nspname`,
      [],
      database,
    );
    return rows.map((r) => ({ name: r.name, system: SYSTEM_SCHEMAS.has(r.name) || r.name.startsWith("pg_") }));
  }

  async listTables(database?: string, schema?: string): Promise<DbAdminTable[]> {
    const rows = await this.rows<{ schema: string; name: string; relkind: string; est: string; size: string }>(
      `SELECT n.nspname AS schema, c.relname AS name, c.relkind, c.reltuples::bigint AS est,
              pg_total_relation_size(c.oid) AS size
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm')
          AND ($1::text IS NULL OR n.nspname = $1)
          AND ($1::text IS NOT NULL OR n.nspname NOT IN ('pg_catalog', 'information_schema'))
          AND n.nspname !~ '^pg_toast'
        ORDER BY n.nspname, c.relname`,
      [schema ?? null],
      database,
    );
    return rows.map((r) => {
      const isView = r.relkind === "v" || r.relkind === "m";
      const estimate = toNumber(r.est);
      return {
        schema: r.schema,
        name: r.name,
        kind: isView ? "view" : "table",
        rowEstimate: isView || estimate === null || estimate < 0 ? null : estimate,
        sizeBytes: toNumber(r.size),
      };
    });
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const schema = requireName(ref.schema ?? "public", "schema");
    const table = requireName(ref.table, "table");
    const [target] = await this.rows<{ oid: number }>(
      `SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
      [schema, table],
      ref.database,
    );
    if (!target) throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "no such table" });

    const columns = await this.rows<{ name: string; type: string; notnull: boolean; def: string | null; pk: boolean }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
              pg_get_expr(d.adbin, d.adrelid) AS def,
              EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS pk
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [target.oid],
      ref.database,
    );
    const indexes = await this.rows<{ name: string; uniq: boolean; prim: boolean; cols: string[] }>(
      `SELECT i.relname AS name, ix.indisunique AS uniq, ix.indisprimary AS prim,
              ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k, true) FROM generate_series(1, ix.indnkeyatts) k) AS cols
         FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid WHERE ix.indrelid = $1 ORDER BY i.relname`,
      [target.oid],
      ref.database,
    );
    const constraints = await this.rows<{ name: string; contype: string; def: string }>(
      `SELECT conname AS name, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1 ORDER BY conname`,
      [target.oid],
      ref.database,
    );
    const types: Record<string, string> = { p: "PRIMARY KEY", f: "FOREIGN KEY", u: "UNIQUE", c: "CHECK", x: "EXCLUDE" };
    return {
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: !c.notnull,
        defaultValue: c.def,
        primaryKey: c.pk,
      })),
      indexes: indexes.map((i) => ({ name: i.name, columns: i.cols, unique: i.uniq, primary: i.prim })),
      constraints: constraints.map((c) => ({ name: c.name, type: types[c.contype] ?? c.contype, definition: c.def })),
    };
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const target = `${q(requireName(ref.schema ?? "public", "schema"))}.${q(requireName(ref.table, "table"))}`;
    const startedAt = Date.now();
    const client = await this.client(ref.database);
    const res = await client.query({
      text: `SELECT * FROM ${target} LIMIT ${page.limit + 1} OFFSET ${page.offset}`,
      rowMode: "array",
    });
    return toResult(
      res.fields.map((f) => f.name),
      res.rows as unknown[][],
      page.limit,
      startedAt,
    );
  }

  async runQuery(sql: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const statement = trimStatement(sql);
    const startedAt = Date.now();
    const client = await this.client(options.database);
    const timeout = Math.round(options.timeoutMs);

    if (!options.readOnly) {
      await client.query(`SET statement_timeout = ${timeout}`);
      // Simple protocol: a pasted script of several statements runs as one batch; the last result is shown.
      const raw = await client.query({ text: sql, rowMode: "array" });
      const res = (Array.isArray(raw) ? raw[raw.length - 1] : raw) as pg.QueryArrayResult;
      return toResult(
        (res.fields ?? []).map((f) => f.name),
        (res.rows ?? []) as unknown[][],
        options.maxRows,
        startedAt,
        res.rowCount ?? 0,
      );
    }

    assertReadOnlyStatement(statement, "postgres");
    await client.query("BEGIN TRANSACTION READ ONLY");
    try {
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      // `queryMode: "extended"` makes the server itself refuse more than one
      // statement, so nothing can `COMMIT` its way out of the read-only
      // transaction. A cursor keeps a huge result from being buffered whole.
      let res: pg.QueryArrayResult;
      if (isRowReturningQuery(statement, "postgres")) {
        await client.query(extended(`DECLARE athanor_cursor NO SCROLL CURSOR FOR ${statement}`));
        res = await client.query({ text: `FETCH ${options.maxRows + 1} FROM athanor_cursor`, rowMode: "array" });
      } else {
        res = await client.query(extended(statement));
      }
      return toResult(
        res.fields.map((f) => f.name),
        res.rows as unknown[][],
        options.maxRows,
        startedAt,
      );
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    if (kind === "database") {
      const database = requireName(ref.database, "database");
      if (SYSTEM_DATABASES.has(database)) throw systemObject(`database ${database}`);
      return [plain(`DROP DATABASE ${q(database)}`)];
    }
    const schema = requireName(ref.schema ?? "public", "schema");
    if (SYSTEM_SCHEMAS.has(schema) || schema.startsWith("pg_")) throw systemObject(`schema ${schema}`);
    const target = `${q(schema)}.${q(requireName(ref.table, "table"))}`;
    if (kind === "column") return [plain(`ALTER TABLE ${target} DROP COLUMN ${q(requireName(ref.column, "column"))}`)];
    return [plain(`DROP ${kind === "view" ? "VIEW" : "TABLE"} ${target}`)];
  }

  privilegeCatalog(): DbPrivilegeCatalog {
    return PRIVILEGES;
  }

  async listPrincipals(): Promise<DbPrincipal[]> {
    const rows = await this.rows<{ name: string; login: boolean; super: boolean; member_of: string[] }>(
      `SELECT r.rolname AS name, r.rolcanlogin AS login, r.rolsuper AS super,
              ARRAY(SELECT b.rolname::text FROM pg_auth_members m JOIN pg_roles b ON b.oid = m.roleid WHERE m.member = r.oid) AS member_of
         FROM pg_roles r ORDER BY r.rolname`,
    );
    return rows.map((r) => ({
      name: r.name,
      kind: r.login ? "user" : "role",
      canLogin: r.login,
      // PostgreSQL has no lock flag: an account is locked by taking LOGIN away.
      locked: false,
      superuser: r.super,
      system: isSystemRole(r.name),
      memberOf: r.member_of ?? [],
    }));
  }

  async listGrants(principal: DbPrincipalRef): Promise<DbGrant[]> {
    const name = requireName(principal.name, "principal");
    const database = optionalName(principal.database, "database");
    const grants: DbGrant[] = [];
    const push = (grant: Omit<DbGrant, "privileges" | "grantable">, privilege: string, grantable: boolean) => {
      const existing = grants.find(
        (g) =>
          g.scope === grant.scope &&
          g.database === grant.database &&
          g.schema === grant.schema &&
          g.table === grant.table &&
          g.grantable === grantable,
      );
      if (existing) existing.privileges.push(privilege);
      else grants.push({ ...grant, privileges: [privilege], grantable });
    };

    const dbRows = await this.rows<{ name: string; priv: string; grantable: boolean }>(
      `SELECT d.datname AS name, a.privilege_type AS priv, a.is_grantable AS grantable
         FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
        WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1) ORDER BY 1, 2`,
      [name],
    );
    for (const r of dbRows) push({ scope: "database", database: r.name }, r.priv, r.grantable);

    const schemaRows = await this.rows<{ name: string; priv: string; grantable: boolean }>(
      `SELECT n.nspname AS name, a.privilege_type AS priv, a.is_grantable AS grantable
         FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
          AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1, 2`,
      [name],
      database,
    );
    for (const r of schemaRows) push({ scope: "schema", database, schema: r.name }, r.priv, r.grantable);

    // A table nobody was ever granted anything on has a NULL ACL: its owner holds the default
    // privileges, as for schemas and databases above — read as such, or they would seem to
    // appear the first time anyone is granted something on it (the accounts watch saw that).
    const tableRows = await this.rows<{ schema: string; name: string; priv: string; grantable: boolean }>(
      `SELECT n.nspname AS schema, c.relname AS name, a.privilege_type AS priv, a.is_grantable AS grantable
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
              aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.relkind IN ('r', 'p', 'v', 'm')
          AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
          AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2, 3`,
      [name],
      database,
    );
    for (const r of tableRows) push({ scope: "table", database, schema: r.schema, table: r.name }, r.priv, r.grantable);
    return grants;
  }

  userStatements(action: DbUserAction): AdminStatement[] {
    const name = requireName(action.principal.name, "principal");
    if (isSystemRole(name)) throw systemObject(`role ${name}`);
    const role = q(name);

    switch (action.type) {
      case "create": {
        const login = action.principal.kind !== "role";
        const statements: AdminStatement[] = [];
        if (login) {
          const password = requirePassword(action.password);
          statements.push({
            sql: `CREATE ROLE ${role} LOGIN PASSWORD ${literal(password)}`,
            display: `CREATE ROLE ${role} LOGIN PASSWORD '${MASK}'`,
          });
        } else {
          statements.push(plain(`CREATE ROLE ${role} NOLOGIN`));
        }
        for (const granted of action.roles ?? [])
          statements.push(plain(`GRANT ${q(requireName(granted, "role"))} TO ${role}`));
        return statements;
      }
      case "drop":
        return [plain(`DROP ROLE ${role}`)];
      case "password": {
        const password = requirePassword(action.password);
        return [
          { sql: `ALTER ROLE ${role} PASSWORD ${literal(password)}`, display: `ALTER ROLE ${role} PASSWORD '${MASK}'` },
        ];
      }
      case "lock":
        return [plain(`ALTER ROLE ${role} ${action.locked ? "NOLOGIN" : "LOGIN"}`)];
      case "grantRole":
        return [plain(`GRANT ${q(requireName(action.role, "role"))} TO ${role}`)];
      case "revokeRole":
        return [plain(`REVOKE ${q(requireName(action.role, "role"))} FROM ${role}`)];
      case "grant":
      case "revoke": {
        const privileges = checkedPrivileges(PRIVILEGES, action.scope, action.privileges).join(", ");
        const target = action.target ?? {};
        let object: string;
        if (action.scope === "database") object = `DATABASE ${q(requireName(target.database, "database"))}`;
        else if (action.scope === "schema") object = `SCHEMA ${q(requireName(target.schema, "schema"))}`;
        else if (action.scope === "table") {
          const schema = q(requireName(target.schema ?? "public", "schema"));
          // No table named: every table of the schema, in one statement.
          object = target.table
            ? `TABLE ${schema}.${q(requireName(target.table, "table"))}`
            : `ALL TABLES IN SCHEMA ${schema}`;
        } else throw unsupported("server-level privileges");
        return action.type === "grant"
          ? [plain(`GRANT ${privileges} ON ${object} TO ${role}${action.withGrantOption ? " WITH GRANT OPTION" : ""}`)]
          : [plain(`REVOKE ${privileges} ON ${object} FROM ${role}`)];
      }
    }
  }

  async listSessions(): Promise<DbAdminSession[]> {
    const rows = await this.rows<{
      pid: number;
      usename: string | null;
      datname: string | null;
      client: string | null;
      state: string | null;
      query: string | null;
      seconds: string | null;
    }>(
      `SELECT pid, usename, datname, client_addr::text AS client, state, query,
              EXTRACT(EPOCH FROM (now() - COALESCE(query_start, backend_start))) AS seconds
         FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND backend_type = 'client backend' ORDER BY query_start NULLS LAST`,
    );
    return rows.map((r) => ({
      id: String(r.pid),
      user: r.usename,
      database: r.datname,
      client: r.client,
      state: r.state,
      query: r.query ? r.query.slice(0, 2000) : null,
      durationSeconds: r.seconds === null ? null : Math.round(Number(r.seconds)),
    }));
  }

  async listBlocking(): Promise<DbBlocking[]> {
    const rows = await this.rows<{ blocked: number; blocker: number }>(
      `SELECT pid AS blocked, unnest(pg_blocking_pids(pid)) AS blocker
         FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0`,
    );
    return rows.map((r) => ({ blocked: String(r.blocked), blocker: String(r.blocker) }));
  }

  async readCounters(): Promise<DbServerCounters> {
    // This database's own counters: PostgreSQL counts transactions, not statements, and has no byte totals.
    const [row] = await this.rows<{ q: string | null; r: string | null }>(
      `SELECT xact_commit + xact_rollback AS q, tup_returned + tup_fetched AS r
         FROM pg_stat_database WHERE datname = current_database()`,
    );
    return {
      queries: toNumber(row?.q),
      queriesKind: "transactions",
      bytesOut: null,
      bytesIn: null,
      rows: toNumber(row?.r),
    };
  }

  killSessionStatements(id: string): AdminStatement[] {
    return [plain(`SELECT pg_terminate_backend(${requireInteger(id, "session id")})`)];
  }

  async execute(statements: AdminStatement[], database?: string): Promise<void> {
    // `DROP DATABASE` can't run inside a transaction, nor from a connection to
    // the database being dropped — it goes through the connection's own database.
    if (statements.some((s) => s.sql.startsWith("DROP DATABASE"))) {
      await this.closeClients((key) => key !== "");
      const client = await this.client();
      for (const statement of statements) await client.query(statement.sql);
      return;
    }
    const client = await this.client(database);
    await client.query("BEGIN");
    try {
      for (const statement of statements) await client.query(statement.sql);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  }

  /** Our own connections count as "other users" of a database: they have to go before it can be dropped. */
  private async closeClients(which: (key: string) => boolean): Promise<void> {
    const pending: Promise<pg.Client>[] = [];
    for (const [key, client] of this.clients) {
      if (!which(key)) continue;
      pending.push(client);
      this.clients.delete(key);
    }
    await Promise.all(pending.map((p) => p.then((c) => c.end()).catch(() => {})));
  }

  async close(): Promise<void> {
    await this.closeClients(() => true);
  }
}
