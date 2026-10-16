import crypto from "node:crypto";
import {
  NOTIFICATION_EVENTS,
  type DirectNotificationEvent,
  type NotificationEvent,
  type NotificationParams,
  type ProjectSubscription,
  type UserNotification,
} from "@nebuladb/shared";
import { filterAsync } from "../../shared/async.js";
import { db } from "../../infrastructure/db.js";
import { notifyProjectUsers } from "../../realtime/roomRegistry.js";
import { ApiError } from "../../shared/errors.js";
import { getEffectivePermission, permissionAtLeast, type PermissionLevel } from "../../shared/permissions.js";

/** Kept per account; older ones go as new ones arrive. A notification is a pointer to what happened, not the record of it. */
const KEPT_PER_USER = 200;
const LISTED = 50;

/** What a user follows on a project; `null` when they do not follow it. */
export async function getProjectSubscription(userId: string, projectId: string): Promise<ProjectSubscription | null> {
  const row = (await db
    .prepare(
      "SELECT events_json, email_drift FROM subscriptions WHERE user_id = ? AND scope_type = 'project' AND scope_id = ?",
    )
    .get(userId, projectId)) as { events_json: string; email_drift: number } | undefined;
  return row ? { events: JSON.parse(row.events_json) as NotificationEvent[], emailDrift: row.email_drift === 1 } : null;
}

/** Everything an account follows — for its personal-data export. */
export async function listSubscriptionsOf(
  userId: string,
): Promise<{ scopeType: string; scopeId: string; events: string[]; emailDrift: boolean }[]> {
  return (
    (await db
      .prepare("SELECT scope_type, scope_id, events_json, email_drift FROM subscriptions WHERE user_id = ?")
      .all(userId)) as {
      scope_type: string;
      scope_id: string;
      events_json: string;
      email_drift: number;
    }[]
  ).map((row) => ({
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    events: JSON.parse(row.events_json) as string[],
    emailDrift: row.email_drift === 1,
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

/** Checks the optional "also by email" choice: absent (keep what was chosen), or a boolean — and `true` only with `drift` followed. */
export function parseEmailDrift(body: unknown, events: NotificationEvent[]): boolean | undefined {
  const value = (body as { emailDrift?: unknown } | null)?.emailDrift;
  if (value === undefined) return undefined;
  if (typeof value !== "boolean" || (value && !events.includes("drift"))) throw new ApiError("SUBSCRIPTION_INVALID");
  return value;
}

/** `emailDrift` left out keeps the earlier choice; it is dropped whenever `drift` is no longer followed. */
export async function saveProjectSubscription(
  userId: string,
  projectId: string,
  events: NotificationEvent[],
  emailDrift?: boolean,
): Promise<ProjectSubscription | null> {
  if (events.length === 0) {
    await db
      .prepare("DELETE FROM subscriptions WHERE user_id = ? AND scope_type = 'project' AND scope_id = ?")
      .run(userId, projectId);
    return null;
  }
  const wanted =
    events.includes("drift") && (emailDrift ?? (await getProjectSubscription(userId, projectId))?.emailDrift === true);
  await db
    .prepare(
      `INSERT INTO subscriptions (user_id, scope_type, scope_id, events_json, email_drift) VALUES (?, 'project', ?, ?, ?)
     ON CONFLICT(user_id, scope_type, scope_id) DO UPDATE SET
       events_json = excluded.events_json, email_drift = excluded.email_drift`,
    )
    .run(userId, projectId, JSON.stringify(events), wanted ? 1 : 0);
  return { events, emailDrift: wanted };
}

interface SubscriberRow {
  user_id: string;
  email: string;
  events_json: string;
  email_drift: number;
}

/**
 * The project's followers of `event` who may see what it is about: following it, enabled, and at
 * the level `needs` now (not when they subscribed — a grant may have gone since).
 */
async function eligibleFollowers(
  projectId: string,
  event: NotificationEvent,
  options: { actor?: { id?: string | null; email?: string | null }; needs?: PermissionLevel },
): Promise<SubscriberRow[]> {
  const followers = (await db
    .prepare(
      `SELECT s.user_id, u.email, s.events_json, s.email_drift
         FROM subscriptions s JOIN users u ON u.id = s.user_id
        WHERE s.scope_type = 'project' AND s.scope_id = ? AND u.disabled_at IS NULL`,
    )
    .all(projectId)) as SubscriberRow[];
  const needed = options.needs ?? "view";
  return await filterAsync(followers, async (follower) => {
    if (!(JSON.parse(follower.events_json) as string[]).includes(event)) return false;
    if (options.actor?.id && follower.user_id === options.actor.id) return false;
    if (options.actor?.email && follower.email.toLowerCase() === options.actor.email.toLowerCase()) return false;
    const level = await getEffectivePermission(follower.user_id, projectId);
    return level !== null && permissionAtLeast(level, needed);
  });
}

/**
 * Addresses of the drift followers who asked for it by email too. The same follower list and
 * the same visibility rules as the in-app notification: who is told there is who is mailed here.
 */
export async function listDriftEmailRecipients(projectId: string, needs?: PermissionLevel): Promise<string[]> {
  return (await eligibleFollowers(projectId, "drift", { needs }))
    .filter((follower) => follower.email_drift === 1)
    .map((follower) => follower.email);
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
export async function notifyFollowers(
  projectId: string,
  event: NotificationEvent,
  params: NotificationParams,
  options: { actor?: { id?: string | null; email?: string | null }; needs?: PermissionLevel } = {},
): Promise<number> {
  try {
    const insert = db.prepare(
      "INSERT INTO notifications (id, user_id, project_id, event, params_json) VALUES (?, ?, ?, ?, ?)",
    );
    const trim = db.prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
         (SELECT id FROM notifications WHERE user_id = ? ORDER BY seq DESC LIMIT ${KEPT_PER_USER})`,
    );
    const told = new Set<string>();
    for (const follower of await eligibleFollowers(projectId, event, options)) {
      await insert.run(crypto.randomUUID(), follower.user_id, projectId, event, JSON.stringify(params));
      await trim.run(follower.user_id, follower.user_id);
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

/**
 * Tells named accounts something that waits for them or answers them — a
 * deployment to review, what became of the review they asked for — whether or
 * not they follow the project. Who is addressed is the caller's rule; disabled
 * accounts and those who can no longer open the project are left out here.
 * Never throws, like `notifyFollowers`.
 */
export async function notifyDirectly(
  projectId: string,
  userIds: Iterable<string>,
  event: DirectNotificationEvent,
  params: NotificationParams,
): Promise<number> {
  try {
    const exists = db.prepare("SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL");
    const insert = db.prepare(
      "INSERT INTO notifications (id, user_id, project_id, event, params_json) VALUES (?, ?, ?, ?, ?)",
    );
    const trim = db.prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
         (SELECT id FROM notifications WHERE user_id = ? ORDER BY seq DESC LIMIT ${KEPT_PER_USER})`,
    );
    const told = new Set<string>();
    for (const userId of new Set(userIds)) {
      if (!(await exists.get(userId)) || !(await getEffectivePermission(userId, projectId))) continue;
      await insert.run(crypto.randomUUID(), userId, projectId, event, JSON.stringify(params));
      await trim.run(userId, userId);
      told.add(userId);
    }
    notifyProjectUsers(projectId, told, { type: "notification" });
    return told.size;
  } catch (err) {
    console.error("[notifications] could not notify directly:", err);
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
export async function listNotifications(
  userId: string,
): Promise<{ notifications: UserNotification[]; unread: number }> {
  const rows = (await db
    .prepare(
      `SELECT n.id, n.project_id, p.name AS project_name, n.event, n.params_json, n.created_at, n.read_at
         FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
        WHERE n.user_id = ? ORDER BY n.seq DESC LIMIT ${LISTED}`,
    )
    .all(userId)) as NotificationRow[];
  const { unread } = (await db
    .prepare("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL")
    .get(userId)) as { unread: number };
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
export async function markNotificationsRead(userId: string, ids: unknown): Promise<number> {
  if (ids === undefined) {
    return (
      await db.prepare("UPDATE notifications SET read_at = utc_now() WHERE user_id = ? AND read_at IS NULL").run(userId)
    ).changes;
  }
  if (!Array.isArray(ids) || ids.length > LISTED || !ids.every((id) => typeof id === "string")) {
    throw new ApiError("SUBSCRIPTION_INVALID");
  }
  const mark = db.prepare(
    "UPDATE notifications SET read_at = utc_now() WHERE user_id = ? AND id = ? AND read_at IS NULL",
  );
  let count = 0;
  for (const id of ids as string[]) count += (await mark.run(userId, id)).changes;
  return count;
}
