import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DbAccessLevel } from "@nebuladb/shared";
import { requireScope } from "../apiKeys/auth.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { connectionOwner, getProjectConnection } from "../connections/repository.js";
import { effectiveDbAccess } from "../dbAccess/repository.js";
import type { DbConsoleUser } from "../dbAccess/service.js";
import { runConsoleQuery } from "../dbAdmin/consoleQuery.js";
import { paramsOf, parseParams } from "../../shared/validate.js";
import { API_RATE_LIMIT } from "./rateLimits.js";

const projectConnectionParams = paramsOf("id", "connId");

/**
 * The SQL access the caller has on one of the project's databases, as the console would give it
 * to a member — never the administrator's console:
 *
 * - their own private connection: `write`;
 * - a connection an administrator granted them (directly or through a team): that grant's level;
 * - an instance administrator without a grant: `write`. Data only (no structure, which goes
 *   through the schema and a deployment), one statement at a time, each write confirmed.
 *
 * Anyone else is refused. The database is the one the project is linked to
 * (`getProjectConnection`): a statement cannot wander to another database on the same server.
 */
async function requireProjectSqlUser(
  req: FastifyRequest,
  projectId: string,
  connectionId: string,
): Promise<DbConsoleUser> {
  const { user } = await requireProjectAccess(req, projectId, "view");
  requireScope(req, "sql:execute", projectId);
  const connection = await getProjectConnection(projectId, connectionId);
  if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");

  let access: DbAccessLevel | null;
  const owner = await connectionOwner(connectionId);
  if (owner) {
    access = owner === user.id ? "write" : null;
  } else {
    // `user.isAdmin` is false for an AI agent's key: the owner's real standing is on the key.
    const ownerIsAdmin = req.apiKey ? req.apiKey.ownerIsAdmin : user.isAdmin;
    access = (await effectiveDbAccess(user.id, connectionId)) ?? (ownerIsAdmin ? "write" : null);
  }
  if (!access) throw new ApiError("SQL_ACCESS_NOT_GRANTED");
  return { user, connection, access };
}

/**
 * SQL on a project's databases under `/api/v1`, for a key carrying `sql:execute` — which only an
 * AI agent's key may (`apiKeys/repository.ts`). The very guards of the SQL console
 * (`dbAdmin/consoleQuery.ts`): read-only unless `readOnly: false`, a write confirmed in the request
 * (`confirmWrite: true`), data statements only, the query history and the audit trail.
 */
export function registerPublicSqlRoutes(app: FastifyInstance): void {
  app.post("/api/v1/projects/:id/connections/:connId/query", API_RATE_LIMIT, async (req) => {
    const { id, connId } = parseParams(projectConnectionParams, req);
    const consoleUser = await requireProjectSqlUser(req, id, connId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { result } = await runConsoleQuery(
      req,
      connId,
      consoleUser,
      {
        sql: body.sql,
        readOnly: body.readOnly,
        confirmWrite: body.confirmWrite,
        maxRows: body.maxRows,
        timeoutMs: body.timeoutMs,
      },
      { pinDatabase: true },
    );
    return { access: consoleUser.access, result };
  });
}
