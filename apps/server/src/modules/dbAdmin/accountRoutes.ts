import type { DbUserAction } from "@nebuladb/shared";
import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { isConnectionAccount } from "./connectionAccount.js";
import { optionalName, requireName } from "./drivers/common.js";
import {
  READ_LIMIT,
  WRITE_LIMIT,
  assertWritable,
  loadConnection,
  previewOrExecute,
  refFromQuery,
  withDriver,
} from "./routeKit.js";

const USER_ACTIONS = ["create", "drop", "password", "lock", "grant", "revoke", "grantRole", "revokeRole"];

export function registerAccountRoutes(app: FastifyInstance): void {
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
    // Nebula itself signs in with cannot be dropped, locked or given a new
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
