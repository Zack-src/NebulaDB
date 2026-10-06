import type { DbAdminObjectRef, StructuralAction } from "@nebuladb/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { markOutOfSchema } from "../connections/drift.js";
import { requireDbConsoleUser, type DbConsoleUser } from "../dbAccess/service.js";
import { optionalName, requireName } from "./drivers/common.js";
import { type DatabaseAdminDriver, type DropKind } from "./drivers/index.js";
import { clearQueryHistory, listQueryHistory, recordQuery } from "./queryHistory.js";
import {
  READ_LIMIT,
  WRITE_LIMIT,
  assertWritable,
  loadConnection,
  previewOrExecute,
  refFromQuery,
  withDriver,
} from "./routeKit.js";
import { assertDataStatement, assertReadOnlyStatement, findStructuralStatements } from "./sqlGuard.js";
import { describeStructuralActions, effectiveStructurePolicy, judgeStructuralActions } from "./structurePolicy.js";

const DEFAULT_MAX_ROWS = 1000;

const MAX_MAX_ROWS = 5000;

const DEFAULT_TIMEOUT_MS = 30_000;

const MAX_TIMEOUT_MS = 120_000;

const DEFAULT_PAGE = 100;

const MAX_PAGE = 500;

const MAX_SQL_LENGTH = 200_000;

const DROP_KINDS: readonly DropKind[] = ["database", "table", "view", "column"];

function clamp(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function describeRef(ref: DbAdminObjectRef): string {
  return [ref.database, ref.schema, ref.table, ref.column].filter(Boolean).join(".");
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

export function registerExplorerRoutes(app: FastifyInstance): void {
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
        editor?: unknown;
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
      const readOnly = body.editor === true || body.readOnly !== false;
      const database = body.editor === true ? connection.database : optionalName(body.database, "database");
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

    app.delete(`${prefix}/:id/query-history`, WRITE_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { user } = guard(req, id);
      return { cleared: clearQueryHistory(id, user.id) };
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
}
