import type { FastifyInstance } from "fastify";
import { requireScope } from "../apiKeys/auth.js";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { liftLock, listLocksFor, placeLock } from "../tableLocks/service.js";
import { API_RATE_LIMIT } from "./rateLimits.js";

/**
 * A script names a table the way its DBML does, so `:table` is the table's
 * id or, failing that, its name (case-insensitive; `schema.name` when the
 * table has a schema). A name two tables share is refused rather than guessed.
 */
function resolveTableId(projectId: string, projectName: string, table: string): string {
  const tables = readProjectReadOnly(projectId, projectName).tables;
  if (tables.some((candidate) => candidate.id === table)) return table;
  const wanted = table.toLowerCase();
  const named = tables.filter(
    (candidate) =>
      candidate.name.toLowerCase() === wanted ||
      (candidate.schemaName !== undefined && `${candidate.schemaName}.${candidate.name}`.toLowerCase() === wanted),
  );
  if (named.length === 1) return named[0].id;
  if (named.length > 1) {
    throw new ApiError("TABLE_NOT_FOUND", { message: `several tables are named "${table}" — use the table's id` });
  }
  // A lock outlives nothing, but an id that is no table's still has to reach
  // `liftLock` to answer "no such lock" rather than "no such table".
  return table;
}

/**
 * Table locks under `/api/v1`: the same rules as the app's routes
 * (`tableLocks/service.ts`) — project administrators place and lift
 * `project` locks, instance administrators `instance` ones — behind a scope.
 */
export function registerPublicLockRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/locks", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return listLocksFor(user.id, id, project.name);
  });

  app.put("/api/v1/projects/:id/locks/:table", API_RATE_LIMIT, async (req) => {
    const { id, table } = req.params as { id: string; table: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:write", id);
    return placeLock(user, id, resolveTableId(id, project.name, table), req.body, req);
  });

  app.delete("/api/v1/projects/:id/locks/:table", API_RATE_LIMIT, async (req) => {
    const { id, table } = req.params as { id: string; table: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    requireScope(req, "projects:write", id);
    liftLock(user, id, resolveTableId(id, project.name, table), req);
    return { unlocked: true };
  });
}
