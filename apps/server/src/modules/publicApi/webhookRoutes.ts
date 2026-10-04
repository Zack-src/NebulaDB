import type { FastifyInstance } from "fastify";
import { requireScope } from "../apiKeys/auth.js";
import { requireProjectAdmin } from "../../shared/guards.js";
import { WEBHOOK_TEST_RATE_LIMIT } from "../webhooks/routes.js";
import {
  changeWebhook,
  createWebhookFor,
  pingWebhook,
  projectWebhooks,
  removeWebhook,
  rotateWebhookSecret,
  webhookDeliveries,
} from "../webhooks/service.js";
import { API_RATE_LIMIT } from "./rateLimits.js";

/**
 * A project's outgoing webhooks under `/api/v1`: the app's own rules
 * (`webhooks/service.ts`, project administrators only) behind a scope —
 * `projects:read` to list them and read their deliveries, `projects:write`
 * for everything that changes one or makes the server send a request.
 */
export function registerPublicWebhookRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/webhooks", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAdmin(req, id);
    requireScope(req, "projects:read", id);
    return { webhooks: projectWebhooks(id) };
  });

  // The signing secret is in this answer and in no later one.
  app.post("/api/v1/projects/:id/webhooks", API_RATE_LIMIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return reply.code(201).send(await createWebhookFor(user, id, req.body, req));
  });

  app.patch("/api/v1/projects/:id/webhooks/:hookId", API_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return changeWebhook(user, id, hookId, req.body, req);
  });

  app.delete("/api/v1/projects/:id/webhooks/:hookId", API_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    removeWebhook(user, id, hookId, req);
    return { deleted: true };
  });

  app.post("/api/v1/projects/:id/webhooks/:hookId/rotate-secret", WEBHOOK_TEST_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return rotateWebhookSecret(user, id, hookId, req);
  });

  app.post("/api/v1/projects/:id/webhooks/:hookId/test", WEBHOOK_TEST_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return pingWebhook(id, hookId);
  });

  app.get("/api/v1/projects/:id/webhooks/:hookId/deliveries", API_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    requireProjectAdmin(req, id);
    requireScope(req, "projects:read", id);
    return { deliveries: webhookDeliveries(id, hookId) };
  });
}
