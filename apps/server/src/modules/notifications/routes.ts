import type { FastifyInstance } from "fastify";
import { requireProjectAccess, requireUser } from "../../shared/guards.js";
import {
  getProjectSubscription,
  listNotifications,
  markNotificationsRead,
  parseSubscription,
  saveProjectSubscription,
} from "./repository.js";
import { listMentionable, notifyCommentAddressees, parseCommentNotice } from "./comments.js";

/**
 * Following a project, and the notifications that follow from it. All of it
 * is the account's own: a subscription and a notification belong to whoever
 * is signed in, and nobody reads or changes someone else's.
 */
export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get("/api/notifications", async (req) => await listNotifications(requireUser(req).id));

  app.post("/api/notifications/read", async (req) => {
    const user = requireUser(req);
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    return { marked: await markNotificationsRead(user.id, ids), ...(await listNotifications(user.id)) };
  });

  app.get("/api/projects/:id/subscription", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "view");
    return { subscription: await getProjectSubscription(user.id, id) };
  });

  // An empty list of events is how one stops following.
  app.put("/api/projects/:id/subscription", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "view");
    return { subscription: await saveProjectSubscription(user.id, id, parseSubscription(req.body)) };
  });

  // Comments live in the shared document, which the server does not read for
  // them: the client that writes one says so here, and the server decides who
  // is told. Writing a comment takes `edit` — the same right as the document.
  app.get("/api/projects/:id/mentionable", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "edit");
    return { users: await listMentionable(id, (req.query as { q?: unknown }).q, user.id) };
  });

  app.post("/api/projects/:id/comment-notices", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAccess(req, id, "edit");
    return { notified: await notifyCommentAddressees(id, user, parseCommentNotice(req.body)) };
  });
}
