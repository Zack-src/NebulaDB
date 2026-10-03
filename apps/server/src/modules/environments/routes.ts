import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";
import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  reorderEnvironments,
  updateEnvironment,
} from "./repository.js";

const WRITE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

/**
 * The deployment chain (Admin → Environnements). Anyone signed in may read it
 * — a project administrator picks a stage when adding a connection, and every
 * badge shows one — but only an instance administrator shapes it.
 */
export function registerEnvironmentRoutes(app: FastifyInstance): void {
  app.get("/api/environments", async (req) => {
    requireUser(req);
    return { environments: listEnvironments() };
  });

  app.post("/api/admin/environments", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const stage = createEnvironment(req.body);
    auditUser(user, "environment.create", { type: "environment", id: stage.id }, stage.name, req);
    return { environment: stage };
  });

  app.patch("/api/admin/environments/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const { before, after } = updateEnvironment(id, req.body);
    const changes = [
      before.name !== after.name ? `name ${before.name} -> ${after.name}` : null,
      before.color !== after.color ? `color ${before.color} -> ${after.color}` : null,
      before.protection !== after.protection ? `protection ${before.protection} -> ${after.protection}` : null,
      before.production !== after.production ? `production ${before.production} -> ${after.production}` : null,
    ].filter(Boolean);
    if (changes.length > 0) {
      auditUser(user, "environment.update", { type: "environment", id }, `${after.name}: ${changes.join(", ")}`, req);
    }
    return { environment: after };
  });

  app.delete("/api/admin/environments/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const removed = deleteEnvironment(id);
    auditUser(
      user,
      "environment.delete",
      { type: "environment", id },
      `${removed.name} (${removed.connectionCount} connection(s) left without a stage)`,
      req,
    );
    return { deleted: true };
  });

  app.put("/api/admin/environments/order", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const environments = reorderEnvironments((req.body as { ids?: unknown } | null)?.ids);
    auditUser(user, "environment.reorder", null, environments.map((stage) => stage.name).join(" > "), req);
    return { environments };
  });
}
