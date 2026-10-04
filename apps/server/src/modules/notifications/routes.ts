import type { FastifyInstance } from "fastify";
import { requireProjectAccess, requireUser } from "../../shared/guards.js";
import {
  getProjectSubscription,
  listNotifications,
  markNotificationsRead,
  parseSubscription,
  saveProjectSubscription,
} from "./repository.js";

/**
 * Following a project, and the notifications that follow from it. All of it
 * is the account's own: a subscription and a notification belong to whoever
 * is signed in, and nobody reads or changes someone else's.
 */
export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get("/api/notifications", async (req) => listNotifications(requireUser(req).id));

  app.post("/api/notifications/read", async (req) => {
    const user = requireUser(req);
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    return { marked: markNotificationsRead(user.id, ids), ...listNotifications(user.id) };
  });

  app.get("/api/projects/:id/subscription", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAccess(req, id, "view");
    return { subscription: getProjectSubscription(user.id, id) };
  });

  // An empty list of events is how one stops following.
  app.put("/api/projects/:id/subscription", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAccess(req, id, "view");
    return { subscription: saveProjectSubscription(user.id, id, parseSubscription(req.body)) };
  });
}
