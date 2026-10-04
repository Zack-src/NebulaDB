import crypto from "node:crypto";
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationParams,
  type ProjectSubscription,
  type UserNotification,
} from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { notifyProjectUsers } from "../../realtime/roomRegistry.js";
import { ApiError } from "../../shared/errors.js";
import { getEffectivePermission, type PermissionLevel } from "../../shared/permissions.js";

/** Kept per account; older ones go as new ones arrive. A notification is a pointer to what happened, not the record of it. */
const KEPT_PER_USER = 200;
const LISTED = 50;

const RANK: Record<PermissionLevel, number> = { view: 1, edit: 2, administrator: 3 };

/** What a user follows on a project; `null` when they do not follow it. */
export function getProjectSubscription(userId: string, projectId: string): ProjectSubscription | null {
  const row = db
    .prepare("SELECT events_json FROM subscriptions WHERE user_id = ? AND scope_type = 'project' AND scope_id = ?")
    .get(userId, projectId) as { events_json: string } | undefined;
  return row ? { events: JSON.parse(row.events_json) as NotificationEvent[] } : null;
}

/** Everything an account follows — for its personal-data export. */
export function listSubscriptionsOf(userId: string): { scopeType: string; scopeId: string; events: string[] }[] {
  return (
    db.prepare("SELECT scope_type, scope_id, events_json FROM subscriptions WHERE user_id = ?").all(userId) as {
      scope_type: string;
      scope_id: string;
      events_json: string;
    }[]
  ).map((row) => ({
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    events: JSON.parse(row.events_json) as string[],
  }));
}

/** Checks what a client sent: a list of known events, without repeats. Empty means "stop following". */
export function parseSubscription(body: unknown): NotificationEvent[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || !events.every((event) => NOTIFICATION_EVENTS.includes(event as NotificationEvent))) {
    throw new ApiError("SUBSCRIPTION_INVALID");
  }
  return NOTIFICATION_EVENTS.filter((event) => events.includes(event));
}

export function saveProjectSubscription(
  userId: string,
  projectId: string,
  events: NotificationEvent[],
): ProjectSubscription | null {
  if (events.length === 0) {
    db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND scope_type = 'project' AND scope_id = ?").run(
      userId,
      projectId,
    );
    return null;
  }
  db.prepare(
    `INSERT INTO subscriptions (user_id, scope_type, scope_id, events_json) VALUES (?, 'project', ?, ?)
     ON CONFLICT(user_id, scope_type, scope_id) DO UPDATE SET events_json = excluded.events_json`,
  ).run(userId, projectId, JSON.stringify(events));
  return { events };
}

interface SubscriberRow {
  user_id: string;
  email: string;
  events_json: string;
}

/**
 * Tells the project's followers that something happened.
 *
 * Two rules decided once, here, for every event: nobody is told about what
 * they did themselves, and nobody is told about what they could not see in
 * the app — `needs` is the level the event's own screen asks for, checked for
 * each follower now, not when they subscribed (a grant may have gone since).
 * Never throws: a notification is a courtesy, not part of the action.
 */
export function notifyFollowers(
  projectId: string,
  event: NotificationEvent,
  params: NotificationParams,
  options: { actor?: { id?: string | null; email?: string | null }; needs?: PermissionLevel } = {},
): number {
  try {
    const followers = db
      .prepare(
        `SELECT s.user_id, u.email, s.events_json
           FROM subscriptions s JOIN users u ON u.id = s.user_id
          WHERE s.scope_type = 'project' AND s.scope_id = ? AND u.disabled_at IS NULL`,
      )
      .all(projectId) as SubscriberRow[];
    const insert = db.prepare(
      "INSERT INTO notifications (id, user_id, project_id, event, params_json) VALUES (?, ?, ?, ?, ?)",
    );
    const trim = db.prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
         (SELECT id FROM notifications WHERE user_id = ? ORDER BY rowid DESC LIMIT ${KEPT_PER_USER})`,
    );
    const needed = RANK[options.needs ?? "view"];
    const told = new Set<string>();
    for (const follower of followers) {
      if (!(JSON.parse(follower.events_json) as string[]).includes(event)) continue;
      if (options.actor?.id && follower.user_id === options.actor.id) continue;
      if (options.actor?.email && follower.email.toLowerCase() === options.actor.email.toLowerCase()) continue;
      const level = getEffectivePermission(follower.user_id, projectId);
      if (!level || RANK[level] < needed) continue;
      insert.run(crypto.randomUUID(), follower.user_id, projectId, event, JSON.stringify(params));
      trim.run(follower.user_id, follower.user_id);
      told.add(follower.user_id);
    }
    // Those who have the project open learn it now rather than at their bell's
    // next poll — they alone: the room at large is not to know who follows.
    notifyProjectUsers(projectId, told, { type: "notification" });
    return told.size;
  } catch (err) {
    console.error("[notifications] could not notify followers:", err);
    return 0;
  }
}

interface NotificationRow {
  id: string;
  project_id: string | null;
  project_name: string | null;
  event: string;
  params_json: string;
  created_at: string;
  read_at: string | null;
}

/** The account's latest notifications, newest first, and how many it has not read. */
export function listNotifications(userId: string): { notifications: UserNotification[]; unread: number } {
  const rows = db
    .prepare(
      `SELECT n.id, n.project_id, p.name AS project_name, n.event, n.params_json, n.created_at, n.read_at
         FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
        WHERE n.user_id = ? ORDER BY n.rowid DESC LIMIT ${LISTED}`,
    )
    .all(userId) as NotificationRow[];
  const { unread } = db
    .prepare("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL")
    .get(userId) as { unread: number };
  return {
    unread,
    notifications: rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      event: row.event as NotificationEvent,
      params: JSON.parse(row.params_json) as NotificationParams,
      createdAt: row.created_at,
      read: row.read_at !== null,
    })),
  };
}

/** Marks some of the account's notifications as read, or all of them. */
export function markNotificationsRead(userId: string, ids: unknown): number {
  if (ids === undefined) {
    return db
      .prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
      .run(userId).changes;
  }
  if (!Array.isArray(ids) || ids.length > LISTED || !ids.every((id) => typeof id === "string")) {
    throw new ApiError("SUBSCRIPTION_INVALID");
  }
  const mark = db.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id = ? AND read_at IS NULL",
  );
  return (ids as string[]).reduce((count, id) => count + mark.run(userId, id).changes, 0);
}
