import type { FastifyInstance } from "fastify";
import { requireProjectAdmin } from "../../shared/guards.js";
import {
  changeWebhook,
  createWebhookFor,
  pingWebhook,
  projectWebhooks,
  removeWebhook,
  rotateWebhookSecret,
  webhookDeliveries,
} from "./service.js";

/**
 * Project-administrator only, same bar as database connections: a webhook
 * makes the server send requests to an address of the caller's choosing, and
 * pushes the project's name and change summaries out of the instance.
 * The rules themselves are in `service.ts`, shared with `/api/v1`.
 */

/** The "send a test" button hits an arbitrary URL on demand — keep a script from turning it into a request cannon. */
export const WEBHOOK_TEST_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export function registerWebhookRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/webhooks", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAdmin(req, id);
    return projectWebhooks(id);
  });

  /** The signing secret is returned here once and never again — store it in the receiving service now. */
  app.post("/api/projects/:id/webhooks", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    return reply.code(201).send(await createWebhookFor(user, id, req.body, req));
  });

  app.patch("/api/projects/:id/webhooks/:hookId", async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    return changeWebhook(user, id, hookId, req.body, req);
  });

  app.delete("/api/projects/:id/webhooks/:hookId", async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    removeWebhook(user, id, hookId, req);
    return { deleted: true };
  });

  app.post("/api/projects/:id/webhooks/:hookId/rotate-secret", WEBHOOK_TEST_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    return rotateWebhookSecret(user, id, hookId, req);
  });

  app.post("/api/projects/:id/webhooks/:hookId/test", WEBHOOK_TEST_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    requireProjectAdmin(req, id);
    return pingWebhook(id, hookId);
  });

  app.get("/api/projects/:id/webhooks/:hookId/deliveries", async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    requireProjectAdmin(req, id);
    return webhookDeliveries(id, hookId);
  });
}
