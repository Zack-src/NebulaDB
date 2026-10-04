import type { FastifyInstance } from "fastify";
import type { TableLocksResponse } from "@athanordb/shared";
import { requireProjectAccess } from "../../shared/guards.js";
import { liftLock, listLocksFor, placeLock } from "./service.js";

/**
 * Table locks: an administrator freezes a table's structure; everyone else
 * keeps reading it and can still move it around the canvas.
 *
 * These routes only record *who locked what*. Enforcement lives on the write
 * paths themselves (`access.ts#assertLocksAllow` for REST, `Room` for
 * realtime), because a lock that only the lock routes know about protects
 * nothing.
 */
export function registerTableLockRoutes(app: FastifyInstance): void {
  // Readable by anyone who can open the project: the padlock and its reason
  // are what tell a collaborator why a table will not let itself be edited.
  app.get("/api/projects/:id/locks", async (req): Promise<TableLocksResponse> => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    return listLocksFor(user.id, id, project.name);
  });

  app.put("/api/projects/:id/locks/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user } = requireProjectAccess(req, id, "view");
    return placeLock(user, id, tableId, req.body, req);
  });

  app.delete("/api/projects/:id/locks/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user } = requireProjectAccess(req, id, "view");
    liftLock(user, id, tableId, req);
    return { unlocked: true };
  });
}
