import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  DatabaseConnectionConfig,
  DbAdminObjectRef,
  DbAdminStatementsResult,
  DbUserAction,
  StructuralAction,
} from "@athanordb/shared";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import type { BudgetKind } from "../connections/connectionBudget.js";
import { markOutOfSchema } from "../connections/drift.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import { isValidEngine } from "../connections/engines.js";
import {
  createGlobalConnection,
  deleteConnection,
  getAdminConnection,
  getConnectionById,
  listAllConnections,
  setConnectionProjects,
  updateGlobalConnection,
} from "../connections/repository.js";
import { optionalName, requireName } from "./drivers/common.js";
import { createAdminDriver, type AdminStatement, type DatabaseAdminDriver, type DropKind } from "./drivers/index.js";
import { checkConnectionHealth } from "./health.js";
import { listQueryHistory, recordQuery } from "./queryHistory.js";
import { requireDbConsoleUser, type DbConsoleUser } from "../dbAccess/service.js";
import { isConnectionAccount } from "./connectionAccount.js";
import { assertDataStatement, assertReadOnlyStatement, findStructuralStatements } from "./sqlGuard.js";
import {
  describeStructuralActions,
  effectiveStructurePolicy,
  getInstanceStructurePolicy,
  judgeStructuralActions,
  parseStructurePolicySetting,
  setInstanceStructurePolicy,
} from "./structurePolicy.js";

/** Reads: listing, browsing, a query. A person clicking through a tree, not a script. */
const READ_LIMIT = { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } };
/** Anything that changes the instance's connection list or the target server. */
const WRITE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

const DEFAULT_MAX_ROWS = 1000;
const MAX_MAX_ROWS = 5000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;
const MAX_SQL_LENGTH = 200_000;
const DROP_KINDS: readonly DropKind[] = ["database", "table", "view", "column"];
const USER_ACTIONS = ["create", "drop", "password", "lock", "grant", "revoke", "grantRole", "revokeRole"];

function clamp(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function loadConnection(id: string): DatabaseConnectionConfig {
  const connection = getConnectionById(id);
  if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
  return connection;
}

/**
 * Opens an administration driver, runs `fn`, always closes. Whatever the
 * target database itself answers is passed through as a 502 with its own
 * message: on these admin-only routes that message *is* the useful part
 * ("permission denied for table x"), where the default handler would hide it
 * behind a generic 500 and file it as a server bug.
 */
async function withDriver<T>(
  connection: DatabaseConnectionConfig,
  kind: BudgetKind,
  fn: (driver: DatabaseAdminDriver) => Promise<T>,
): Promise<T> {
  const driver = await createAdminDriver(connection, kind);
  try {
    return await fn(driver);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("DB_ADMIN_QUERY_FAILED", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    await driver.close().catch(() => {});
  }
}

function assertWritable(connection: DatabaseConnectionConfig): void {
  if (connection.readOnly) throw new ApiError("CONNECTION_READ_ONLY");
}

function refFromQuery(req: FastifyRequest): DbAdminObjectRef {
  const query = req.query as Record<string, string | undefined>;
  return {
    database: optionalName(query.database, "database"),
    schema: optionalName(query.schema, "schema"),
    table: optionalName(query.table, "table"),
  };
}

function parseConnectionBody(body: Record<string, unknown>, partial: boolean): Partial<DatabaseConnectionConfig> {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new ApiError("NAME_REQUIRED");
    if (body.name.length > 200) throw new ApiError("NAME_TOO_LONG");
  }
  if (!partial || body.engine !== undefined) {
    if (!isValidEngine(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
  // `null` clears the connection's own policy (back to the instance default).
  if (body.structurePolicy !== undefined && body.structurePolicy !== null) {
    body = { ...body, structurePolicy: parseStructurePolicySetting(body.structurePolicy) };
  }
  // Server-assigned or meaningless here; never taken from the client.
  const config = { ...body };
  for (const key of ["id", "projectId", "createdAt", "updatedAt"]) delete config[key];
  return config as Partial<DatabaseConnectionConfig>;
}

function describeRef(ref: DbAdminObjectRef): string {
  return [ref.database, ref.schema, ref.table, ref.column].filter(Boolean).join(".");
}

async function previewOrExecute(
  driver: DatabaseAdminDriver,
  statements: AdminStatement[],
  execute: boolean,
  database: string | undefined,
): Promise<DbAdminStatementsResult> {
  if (execute) await driver.execute(statements, database);
  return { sql: statements.map((s) => s.display), executed: execute };
}

/**
 * The administration console's API — instance-level connections and
 * everything done *on* a connected server. Every route requires the global
 * administrator, checked server-side: these read and change real databases
 * with the stored credentials, which is a strictly larger power than
 * administering any one project.
 */
export function registerDbAdminRoutes(app: FastifyInstance): void {
  // ---- Connections ---------------------------------------------------------

  app.get("/api/admin/connections", READ_LIMIT, async (req) => {
    requireAdmin(req);
    return { connections: listAllConnections() };
  });

  app.post("/api/admin/connections", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const config = parseConnectionBody((req.body ?? {}) as Record<string, unknown>, false) as DatabaseConnectionConfig;
    const connection = createGlobalConnection(config, user.id);
    auditUser(
      user,
      "dbconn.create",
      { type: "connection", id: connection.id },
      `${connection.engine}: ${connection.name}`,
      req,
    );
    return { connection };
  });

  app.put("/api/admin/connections/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const updates = parseConnectionBody((req.body ?? {}) as Record<string, unknown>, true);
    const before = getAdminConnection(id);
    const connection = updateGlobalConnection(id, updates);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    auditUser(user, "dbconn.update", { type: "connection", id }, `${connection.engine}: ${connection.name}`, req);
    // Its own line in the trail: loosening a policy is the kind of change someone asks about later.
    const describe = (setting: typeof connection.structurePolicy) =>
      setting ? `${setting.policy}${setting.applyToSql ? "" : " (not SQL)"}` : "instance default";
    if (before && before.authMode !== connection.authMode) {
      auditUser(
        user,
        "dbconn.auth_mode",
        { type: "connection", id },
        `${connection.name}: ${before.authMode} -> ${connection.authMode}`,
        req,
      );
    }
    if (describe(before?.structurePolicy ?? null) !== describe(connection.structurePolicy)) {
      auditUser(
        user,
        "dbconn.policy",
        { type: "connection", id },
        `${connection.name}: ${describe(before?.structurePolicy ?? null)} -> ${describe(connection.structurePolicy)}`,
        req,
      );
    }
    return { connection };
  });

  app.delete("/api/admin/connections/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const { force } = req.query as { force?: string };
    const connection = getAdminConnection(id);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    // Projects lose the ability to deploy to it; nothing else of theirs is touched.
    if (connection.projects.length > 0 && force !== "true") {
      throw new ApiError("CONNECTION_IN_USE", { details: { projects: connection.projects } });
    }
    deleteConnection(id);
    auditUser(user, "dbconn.delete", { type: "connection", id }, `${connection.engine}: ${connection.name}`, req);
    return { deleted: true };
  });

  app.put("/api/admin/connections/:id/projects", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const { projectIds } = (req.body ?? {}) as { projectIds?: unknown };
    if (!Array.isArray(projectIds) || projectIds.some((p) => typeof p !== "string")) {
      throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "projectIds must be an array of project ids" });
    }
    if (!getAdminConnection(id)) throw new ApiError("CONNECTION_NOT_FOUND");
    setConnectionProjects(id, projectIds as string[]);
    const connection = getAdminConnection(id)!;
    auditUser(user, "dbconn.link", { type: "connection", id }, `${connection.projects.length} project(s)`, req);
    return { connection };
  });

  app.post("/api/admin/connections/test", WRITE_LIMIT, async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Partial<DatabaseConnectionConfig> & { id?: string };
    if (!isValidEngine(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
    // Editing an existing connection: the form never has the stored password,
    // so an empty one means "the one already saved".
    const stored = body.id ? getConnectionById(body.id) : null;
    const config = { ...body, password: body.password || stored?.password } as DatabaseConnectionConfig;
    if (stored?.connectionString && body.connectionString?.includes("***"))
      config.connectionString = stored.connectionString;

    const driver = await createDatabaseDriver(config);
    try {
      return await driver.testConnection();
    } finally {
      await driver.close().catch(() => {});
    }
  });

  app.post("/api/admin/connections/:id/health", WRITE_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const connection = await checkConnectionHealth(id);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    return { connection };
  });

  // ---- Structure policy ----------------------------------------------------

  app.get("/api/admin/settings/structure-policy", READ_LIMIT, async (req) => {
    requireAdmin(req);
    return { setting: getInstanceStructurePolicy() };
  });

  app.put("/api/admin/settings/structure-policy", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const setting = parseStructurePolicySetting(req.body);
    const previous = getInstanceStructurePolicy();
    setInstanceStructurePolicy(setting, user.id);
    auditUser(
      user,
      "instance.structure_policy",
      null,
      `${previous.policy}${previous.applyToSql ? "" : " (not SQL)"} -> ${setting.policy}${setting.applyToSql ? "" : " (not SQL)"}`,
      req,
    );
    return { setting };
  });

  // ---- Explorer and SQL ----------------------------------------------------
  // Registered twice. Under `/api/admin/connections`: the console's own
  // routes, instance administrators only, unchanged. Under `/api/connections`:
  // whoever `requireDbConsoleUser` lets in — instance administrators, with the
  // same rights, and members an administrator granted this connection to,
  // with narrower ones: reading, and for `write` data statements only, each
  // confirmed. Never structure, and nothing else of the console (drops,
  // accounts, sessions, backups stay on the admin-only routes).

  const consoleRoutes: [string, (req: FastifyRequest, id: string) => DbConsoleUser][] = [
    [
      "/api/admin/connections",
      (req, id) => ({ user: requireAdmin(req), connection: loadConnection(id), access: "admin" }),
    ],
    ["/api/connections", requireDbConsoleUser],
  ];

  for (const [prefix, guard] of consoleRoutes) {
    app.get(`${prefix}/:id/overview`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection, access } = guard(req, id);
      const member = access !== "admin";
      return withDriver(connection, "admin", async (driver) => {
        const policy = effectiveStructurePolicy(id);
        return {
          access,
          // What a member is never offered, so the console does not show it.
          capabilities: member
            ? { ...driver.capabilities, users: false, sessions: false, dropDatabase: false }
            : driver.capabilities,
          privileges: driver.privilegeCatalog(),
          readOnly: Boolean(connection.readOnly),
          // The projects modelling this database are named to administrators only.
          structurePolicy: member ? { ...policy, projects: [] } : policy,
          defaultDatabase: connection.database ?? null,
          databases: await driver.listDatabases(),
        };
      });
    });

    app.get(`${prefix}/:id/schemas`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection } = guard(req, id);
      const ref = refFromQuery(req);
      return withDriver(connection, "admin", async (driver) => ({
        schemas: await driver.listSchemas(ref.database),
      }));
    });

    app.get(`${prefix}/:id/tables`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection } = guard(req, id);
      const ref = refFromQuery(req);
      return withDriver(connection, "admin", async (driver) => ({
        tables: await driver.listTables(ref.database, ref.schema),
      }));
    });

    app.get(`${prefix}/:id/table`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection } = guard(req, id);
      const ref = refFromQuery(req);
      requireName(ref.table, "table");
      return withDriver(connection, "admin", async (driver) => ({
        description: await driver.describeTable(ref),
      }));
    });

    app.get(`${prefix}/:id/rows`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection } = guard(req, id);
      const ref = refFromQuery(req);
      requireName(ref.table, "table");
      const { limit, offset } = req.query as { limit?: string; offset?: string };
      const page = {
        limit: clamp(limit, DEFAULT_PAGE, MAX_PAGE),
        offset: Math.max(0, Math.trunc(Number(offset) || 0)),
      };
      return withDriver(connection, "admin", async (driver) => ({
        result: await driver.browseRows(ref, page),
        ...page,
      }));
    });

    app.post(`${prefix}/:id/query`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { user, connection, access } = guard(req, id);
      const member = access !== "admin";
      const body = (req.body ?? {}) as {
        sql?: unknown;
        database?: unknown;
        readOnly?: unknown;
        confirmStructural?: unknown;
        confirmWrite?: unknown;
        maxRows?: unknown;
        timeoutMs?: unknown;
      };
      if (typeof body.sql !== "string" || !body.sql.trim() || body.sql.length > MAX_SQL_LENGTH) {
        throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "sql is required" });
      }
      const sql = body.sql;
      // Read-only unless explicitly switched off — a missing flag must never mean "write".
      const readOnly = body.readOnly !== false;
      const database = optionalName(body.database, "database");
      if (!readOnly && access === "read") throw new ApiError("DB_ACCESS_WRITE_FORBIDDEN");
      if (!readOnly) assertWritable(connection);
      // A member's write is confirmed in the request itself, not only by a dialog the client may skip.
      if (!readOnly && member && body.confirmWrite !== true) {
        throw new ApiError("DB_ACCESS_WRITE_CONFIRMATION_REQUIRED");
      }

      // Read-only mode already refuses any DDL, so only a write can be structural.
      // Judged before anything runs: a refusal must leave the database untouched.
      // Found whatever the policy says: a structural change made under `free`, or
      // typed where the policy does not cover SQL, still leaves the schema behind
      // and the projects modelling this database are told so. (A member never
      // gets this far with one: `assertDataStatement` below refuses structure.)
      let structural: StructuralAction[] = [];
      let outOfSchema = false;
      let leavesSchemaBehind = false;
      if (!readOnly && !member) {
        const policy = effectiveStructurePolicy(id);
        structural = findStructuralStatements(sql, connection.engine);
        outOfSchema =
          judgeStructuralActions(policy, policy.applyToSql ? structural : [], body.confirmStructural === true) ===
          "out-of-schema";
        leavesSchemaBehind = structural.length > 0 && policy.projects.length > 0;
      }

      const startedAt = Date.now();
      const record = (success: boolean, rowCount: number | null, error: string | null) => {
        const durationMs = Date.now() - startedAt;
        recordQuery({
          connectionId: id,
          userId: user.id,
          database: database ?? null,
          sql,
          readOnly,
          success,
          rowCount,
          durationMs,
          error,
        });
        // The statement text, never its result: rows can hold anything.
        auditUser(
          user,
          member ? "dbaccess.query" : "dbadmin.query",
          { type: "connection", id },
          `${member ? `[${access} access] ` : ""}${readOnly ? "read" : "WRITE"} ${success ? `ok ${rowCount ?? 0} row(s)` : "failed"} ${durationMs}ms: ${sql.replace(/\s+/g, " ").trim()}`,
          req,
        );
      };

      try {
        // Checked here rather than left to the drivers so that a member's refused
        // statement is in the history and the audit trail like any other attempt.
        if (member) {
          if (readOnly) assertReadOnlyStatement(sql, connection.engine);
          else assertDataStatement(sql, connection.engine);
        }
        const result = await withDriver(connection, readOnly ? "admin" : "adminWrite", (driver) =>
          driver.runQuery(sql, {
            database,
            readOnly,
            // Members get the default ceilings, which are also their maximum.
            maxRows: clamp(body.maxRows, DEFAULT_MAX_ROWS, member ? DEFAULT_MAX_ROWS : MAX_MAX_ROWS),
            timeoutMs: clamp(body.timeoutMs, DEFAULT_TIMEOUT_MS, member ? DEFAULT_TIMEOUT_MS : MAX_TIMEOUT_MS),
          }),
        );
        record(true, result.rowCount, null);
        if (leavesSchemaBehind) markOutOfSchema(id, `sql: ${describeStructuralActions(structural)}`);
        if (outOfSchema) {
          auditUser(
            user,
            "dbadmin.structure.out_of_schema",
            { type: "connection", id },
            `sql: ${describeStructuralActions(structural)}`,
            req,
          );
        }
        return { result };
      } catch (err) {
        record(false, null, err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

    app.get(`${prefix}/:id/query-history`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { user } = guard(req, id);
      return { history: listQueryHistory(id, user.id) };
    });
  }

  // ---- Drop ----------------------------------------------------------------

  app.post("/api/admin/connections/:id/drop", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { kind?: DropKind; ref?: DbAdminObjectRef; confirm?: unknown; execute?: unknown };
    const kind = body.kind;
    if (!kind || !DROP_KINDS.includes(kind))
      throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "kind is invalid" });
    const ref: DbAdminObjectRef = {
      database: optionalName(body.ref?.database, "database"),
      schema: optionalName(body.ref?.schema, "schema"),
      table: optionalName(body.ref?.table, "table"),
      column: optionalName(body.ref?.column, "column"),
    };
    const execute = body.execute === true;
    const connection = loadConnection(id);
    if (execute) assertWritable(connection);

    // Tables and columns are what a project models; a view or a whole database
    // is not, so there is no schema to send those through. Checked on the
    // preview too: under `schema-only` the answer is the same before and after
    // the confirmation, and saying so first spares the user typing the name.
    // Under `warn`, typing that name *is* the explicit confirmation.
    const structural: StructuralAction[] =
      kind === "table"
        ? [{ verb: "drop", kind: "table", object: ref.table ?? null }]
        : kind === "column"
          ? [{ verb: "alter", kind: "table", object: ref.table ?? null, column: ref.column }]
          : [];
    const dropPolicy = effectiveStructurePolicy(id);
    const outOfSchema = judgeStructuralActions(dropPolicy, structural, true) === "out-of-schema" && execute;

    const result = await withDriver(connection, execute ? "adminWrite" : "admin", async (driver) => {
      // The object must be one the server itself lists — never a name taken on trust — and not a system one.
      const targetName = await resolveDropTarget(driver, kind, ref);
      const statements = driver.dropStatements(kind, ref);
      if (execute && body.confirm !== targetName) throw new ApiError("DB_ADMIN_CONFIRMATION_MISMATCH");
      return previewOrExecute(driver, statements, execute, ref.database);
    });
    if (execute) auditUser(user, "dbadmin.drop", { type: "connection", id }, `${kind} ${describeRef(ref)}`, req);
    if (execute && structural.length > 0 && dropPolicy.projects.length > 0) {
      markOutOfSchema(id, `explorer: ${describeStructuralActions(structural)}`);
    }
    if (outOfSchema) {
      auditUser(
        user,
        "dbadmin.structure.out_of_schema",
        { type: "connection", id },
        `explorer: ${describeStructuralActions(structural)}`,
        req,
      );
    }
    return result;
  });

  // ---- Users & permissions -------------------------------------------------

  app.get("/api/admin/connections/:id/principals", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const { database } = refFromQuery(req);
    return withDriver(loadConnection(id), "admin", async (driver) => ({
      principals: await driver.listPrincipals(database),
    }));
  });

  app.get("/api/admin/connections/:id/grants", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const query = req.query as Record<string, string | undefined>;
    const principal = {
      name: requireName(query.name, "name"),
      host: query.host || undefined,
      kind: query.kind === "role" ? ("role" as const) : ("user" as const),
      database: optionalName(query.database, "database"),
    };
    return withDriver(loadConnection(id), "admin", async (driver) => ({ grants: await driver.listGrants(principal) }));
  });

  app.post("/api/admin/connections/:id/users", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { action?: DbUserAction; execute?: unknown };
    const action = body.action;
    if (
      !action ||
      !USER_ACTIONS.includes(action.type) ||
      typeof action.principal !== "object" ||
      action.principal === null
    ) {
      throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "action is invalid" });
    }
    requireName(action.principal.name, "principal");
    const database = optionalName(action.principal.database, "database");
    const execute = body.execute === true;
    const connection = loadConnection(id);
    // Refused on the preview already, before anything connects: the account
    // Athanor itself signs in with cannot be dropped, locked or given a new
    // password from here — that would lock the console out of the database.
    const locksOut =
      action.type === "drop" || action.type === "password" || (action.type === "lock" && action.locked !== false);
    if (locksOut && isConnectionAccount(connection, action.principal.name, user.id)) {
      throw new ApiError("DB_ADMIN_CONNECTION_ACCOUNT_PROTECTED", {
        details: { principal: action.principal.name },
      });
    }
    if (execute) assertWritable(connection);

    const result = await withDriver(connection, execute ? "adminWrite" : "admin", async (driver) => {
      if (action.type !== "create") {
        // Only accounts the server lists, and never a built-in one.
        const principals = await driver.listPrincipals(database);
        const host = action.principal.host ?? "%";
        const target = principals.find(
          (p) => p.name === action.principal.name && (p.host === undefined || p.host === host),
        );
        if (!target) throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "no such user or role on this server" });
        if (target.system) throw new ApiError("DB_ADMIN_SYSTEM_OBJECT");
        action.principal.kind = target.kind;
      }
      // Where it runs matters: a SQL Server database user lives in its database, and a
      // PostgreSQL schema or table grant only means something inside the database it names.
      const runIn = database ?? ("target" in action ? optionalName(action.target?.database, "database") : undefined);
      return previewOrExecute(driver, driver.userStatements(action), execute, runIn);
    });
    if (execute) {
      const auditAction =
        action.type === "create"
          ? "dbuser.create"
          : action.type === "drop"
            ? "dbuser.drop"
            : action.type === "password"
              ? "dbuser.password"
              : action.type === "lock"
                ? "dbuser.alter"
                : action.type === "grant" || action.type === "grantRole"
                  ? "dbuser.grant"
                  : "dbuser.revoke";
      // `result.sql` is the masked text — a password never reaches the audit log.
      auditUser(user, auditAction, { type: "connection", id }, result.sql.join("; "), req);
    }
    return result;
  });

  // ---- Sessions ------------------------------------------------------------

  app.get("/api/admin/connections/:id/sessions", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    return withDriver(loadConnection(id), "admin", async (driver) => ({ sessions: await driver.listSessions() }));
  });

  app.post("/api/admin/connections/:id/sessions/kill", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { sessionId?: unknown; execute?: unknown };
    if (typeof body.sessionId !== "string" || !body.sessionId) {
      throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "sessionId is required" });
    }
    const sessionId = body.sessionId;
    const execute = body.execute === true;
    const connection = loadConnection(id);
    if (execute) assertWritable(connection);
    const result = await withDriver(connection, execute ? "adminWrite" : "admin", (driver) =>
      previewOrExecute(driver, driver.killSessionStatements(sessionId), execute, undefined),
    );
    if (execute) auditUser(user, "dbadmin.session.kill", { type: "connection", id }, sessionId, req);
    return result;
  });
}

/** Checks the object exists and isn't a system one; returns the name the caller must type to confirm. */
async function resolveDropTarget(driver: DatabaseAdminDriver, kind: DropKind, ref: DbAdminObjectRef): Promise<string> {
  const notFound = () => new ApiError("DB_ADMIN_INPUT_INVALID", { message: `no such ${kind} on this server` });
  if (kind === "database") {
    if (!driver.capabilities.dropDatabase) throw new ApiError("DB_ADMIN_UNSUPPORTED");
    const database = (await driver.listDatabases()).find((d) => d.name === ref.database);
    if (!database) throw notFound();
    if (database.system) throw new ApiError("DB_ADMIN_SYSTEM_OBJECT");
    return database.name;
  }
  if (driver.capabilities.multiDatabase && ref.database) {
    const database = (await driver.listDatabases()).find((d) => d.name === ref.database);
    if (!database) throw notFound();
    if (database.system) throw new ApiError("DB_ADMIN_SYSTEM_OBJECT");
  }
  if (driver.capabilities.schemas && ref.schema) {
    const schema = (await driver.listSchemas(ref.database)).find((s) => s.name === ref.schema);
    if (schema?.system) throw new ApiError("DB_ADMIN_SYSTEM_OBJECT");
  }
  const table = (await driver.listTables(ref.database, ref.schema)).find(
    (t) => t.name === ref.table && (!ref.schema || t.schema === ref.schema),
  );
  if (!table || (kind !== "column" && table.kind !== kind)) throw notFound();
  if (kind !== "column") return table.name;
  const column = (await driver.describeTable(ref)).columns.find((c) => c.name === ref.column);
  if (!column) throw notFound();
  return column.name;
}
