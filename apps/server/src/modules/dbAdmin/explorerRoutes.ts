import type { DbAdminObjectRef, StructuralAction } from "@nebuladb/shared";
import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { markOutOfSchema } from "../connections/drift.js";
import { optionalName, requireName } from "./drivers/common.js";
import { type DatabaseAdminDriver, type DropKind } from "./drivers/index.js";
import { runConsoleQuery } from "./consoleQuery.js";
import { clearQueryHistory, listQueryHistory } from "./queryHistory.js";
import {
  CONSOLE_ROUTES,
  READ_LIMIT,
  WRITE_LIMIT,
  assertWritable,
  loadConnection,
  pageFromQuery,
  previewOrExecute,
  refFromQuery,
  withDriver,
} from "./routeKit.js";
import { describeStructuralActions, effectiveStructurePolicy, judgeStructuralActions } from "./structurePolicy.js";

const DROP_KINDS: readonly DropKind[] = ["database", "table", "view", "column"];

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

  for (const [prefix, guard] of CONSOLE_ROUTES) {
    app.get(`${prefix}/:id/overview`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection, access } = await guard(req, id);
      const member = access !== "admin";
      return withDriver(connection, "admin", async (driver) => {
        const policy = await effectiveStructurePolicy(id);
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
      const { connection } = await guard(req, id);
      const ref = refFromQuery(req);
      return withDriver(connection, "admin", async (driver) => ({
        schemas: await driver.listSchemas(ref.database),
      }));
    });

    app.get(`${prefix}/:id/tables`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection } = await guard(req, id);
      const ref = refFromQuery(req);
      return withDriver(connection, "admin", async (driver) => ({
        tables: await driver.listTables(ref.database, ref.schema),
      }));
    });

    app.get(`${prefix}/:id/table`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection } = await guard(req, id);
      const ref = refFromQuery(req);
      requireName(ref.table, "table");
      return withDriver(connection, "admin", async (driver) => ({
        description: await driver.describeTable(ref),
      }));
    });

    app.get(`${prefix}/:id/rows`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { connection } = await guard(req, id);
      const ref = refFromQuery(req);
      requireName(ref.table, "table");
      const page = pageFromQuery(req);
      return withDriver(connection, "admin", async (driver) => ({
        result: await driver.browseRows(ref, page),
        ...page,
      }));
    });

    app.post(`${prefix}/:id/query`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      return await runConsoleQuery(req, id, await guard(req, id), req.body);
    });

    app.get(`${prefix}/:id/query-history`, READ_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { user } = await guard(req, id);
      return { history: await listQueryHistory(id, user.id) };
    });

    app.delete(`${prefix}/:id/query-history`, WRITE_LIMIT, async (req) => {
      const { id } = req.params as { id: string };
      const { user } = await guard(req, id);
      return { cleared: await clearQueryHistory(id, user.id) };
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
    const connection = await loadConnection(id);
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
    const dropPolicy = await effectiveStructurePolicy(id);
    const outOfSchema = judgeStructuralActions(dropPolicy, structural, true) === "out-of-schema" && execute;

    const result = await withDriver(connection, execute ? "adminWrite" : "admin", async (driver) => {
      // The object must be one the server itself lists — never a name taken on trust — and not a system one.
      const targetName = await resolveDropTarget(driver, kind, ref);
      const statements = driver.dropStatements(kind, ref);
      if (execute && body.confirm !== targetName) throw new ApiError("DB_ADMIN_CONFIRMATION_MISMATCH");
      return previewOrExecute(driver, statements, execute, ref.database);
    });
    if (execute) await auditUser(user, "dbadmin.drop", { type: "connection", id }, `${kind} ${describeRef(ref)}`, req);
    if (execute && structural.length > 0 && dropPolicy.projects.length > 0) {
      await markOutOfSchema(id, `explorer: ${describeStructuralActions(structural)}`);
    }
    if (outOfSchema) {
      await auditUser(
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
