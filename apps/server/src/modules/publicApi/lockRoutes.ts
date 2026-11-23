import type { FastifyInstance } from "fastify";
import { refuseAgentKey, requireScope } from "../apiKeys/auth.js";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { findTable } from "./tableRef.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { liftLock, listLocksFor, placeLock } from "../tableLocks/service.js";
import { API_RATE_LIMIT } from "./rateLimits.js";
import { parseParams, idParams, paramsOf } from "../../shared/validate.js";

const idTableParams = paramsOf("id", "table");

/** `:table` is the table's id or name (`findTable`). */
async function resolveTableId(projectId: string, projectName: string, table: string): Promise<string> {
  // A lock outlives nothing, but an id that is no table's still has to reach
  // `liftLock` to answer "no such lock" rather than "no such table".
  return findTable((await readProjectReadOnly(projectId, projectName)).tables, table)?.id ?? table;
}

/**
 * Table locks under `/api/v1`: the same rules as the app's routes
 * (`tableLocks/service.ts`) — project administrators place and lift
 * `project` locks, instance administrators `instance` ones — behind a scope.
 */
export function registerPublicLockRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/locks", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user, project } = await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return await listLocksFor(user.id, id, project.name);
  });

  app.put("/api/v1/projects/:id/locks/:table", API_RATE_LIMIT, async (req) => {
    const { id, table } = parseParams(idTableParams, req);
    // Locks are administration: an AI agent lives with them, it never places or lifts one.
    refuseAgentKey(req);
    const { user, project } = await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:write", id);
    return await placeLock(user, id, await resolveTableId(id, project.name, table), req.body, req);
  });

  app.delete("/api/v1/projects/:id/locks/:table", API_RATE_LIMIT, async (req) => {
    const { id, table } = parseParams(idTableParams, req);
    // Locks are administration: an AI agent lives with them, it never places or lifts one.
    refuseAgentKey(req);
    const { user, project } = await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:write", id);
    await liftLock(user, id, await resolveTableId(id, project.name, table), req);
    return { unlocked: true };
  });
}
