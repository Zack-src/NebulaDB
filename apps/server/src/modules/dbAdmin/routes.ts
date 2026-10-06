import type { FastifyInstance } from "fastify";
import { ApiError } from "../../shared/errors.js";
import { connectionOwner } from "../connections/repository.js";
import { registerAccountRoutes } from "./accountRoutes.js";
import { registerConnectionAdminRoutes } from "./connectionAdminRoutes.js";
import { registerExplorerRoutes } from "./explorerRoutes.js";

/**
 * The administration console's API: instance-level connections and everything done *on* a
 * connected server. Every route requires the global administrator, checked server-side: these
 * read and change real databases with the stored credentials, a larger power than administering
 * any one project.
 */
export function registerDbAdminRoutes(app: FastifyInstance): void {
  // A private database is never an administrative connection, including on
  // monitoring routes registered by other modules. Its actions stay in audit.
  app.addHook("preHandler", async (req) => {
    if (!req.routeOptions.url?.startsWith("/api/admin/connections/:id")) return;
    const { id } = req.params as { id: string };
    if (connectionOwner(id)) throw new ApiError("CONNECTION_NOT_FOUND");
  });

  registerConnectionAdminRoutes(app);
  registerExplorerRoutes(app);
  registerAccountRoutes(app);
}
