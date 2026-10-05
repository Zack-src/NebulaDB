import crypto from "node:crypto";
import { extractMentionedUserIds, type DirectNotificationEvent } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { notifyProjectUsers } from "../../realtime/roomRegistry.js";
import { ApiError } from "../../shared/errors.js";
import { getEffectivePermission } from "../../shared/permissions.js";

/** Same bound as the rest of the inbox (see `repository.ts`): older ones go as new ones arrive. */
const KEPT_PER_USER = 200;
const MENTIONABLE_LISTED = 8;
const MAX_NAME = 120;
const MAX_THREAD_AUTHORS = 50;
const MAX_TEXT = 4000;

export interface MentionableUser {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
}

const shownName = (row: UserRow) => row.display_name?.trim() || row.email.split("@")[0];

/**
 * Who `@` may offer when writing a comment on a project: accounts that can
 * see it, and no one else — a comment box must not be a way to browse the
 * directory. The right is read now (`getEffectivePermission`), whatever team
 * the person was in when they last opened the project. The author is left out:
 * mentioning oneself notifies nobody.
 */
export function listMentionable(projectId: string, query: unknown, actorId: string): MentionableUser[] {
  const q = typeof query === "string" ? query.trim().toLowerCase().slice(0, 40) : "";
  const like = `%${q.replace(/[\\%_]/g, String.raw`\$&`)}%`;
  const rows = db
    .prepare(
      `SELECT id, email, display_name FROM users
        WHERE disabled_at IS NULL AND id != ?
          AND (? = '' OR lower(coalesce(display_name, '')) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\')
        ORDER BY lower(coalesce(nullif(trim(display_name), ''), email)) LIMIT 500`,
    )
    .all(actorId, q, like, like) as UserRow[];
  const found: MentionableUser[] = [];
  for (const row of rows) {
    if (!getEffectivePermission(row.id, projectId)) continue;
    found.push({ id: row.id, name: shownName(row) });
    if (found.length === MENTIONABLE_LISTED) break;
  }
  return found;
}

export interface CommentNotice {
  text: string;
  tableName: string;
  columnName: string | null;
  /** Accounts that wrote earlier in the thread, as the client saw it. */
  threadUserIds: string[];
}

/** Checks what a client sent about a comment it has just written. */
export function parseCommentNotice(body: unknown): CommentNotice {
  const raw = (body ?? {}) as Record<string, unknown>;
  const { text, tableName, columnName, threadUserIds } = raw;
  const ids = threadUserIds === undefined ? [] : threadUserIds;
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > MAX_TEXT ||
    typeof tableName !== "string" ||
    tableName.length === 0 ||
    (columnName !== undefined && columnName !== null && typeof columnName !== "string") ||
    !Array.isArray(ids) ||
    ids.length > MAX_THREAD_AUTHORS ||
    !ids.every((id) => typeof id === "string")
  ) {
    throw new ApiError("COMMENT_NOTICE_INVALID");
  }
  return {
    text,
    tableName: tableName.slice(0, MAX_NAME),
    columnName: typeof columnName === "string" && columnName ? columnName.slice(0, MAX_NAME) : null,
    threadUserIds: [...new Set(ids as string[])],
  };
}

/**
 * Tells the people a comment is addressed to: those it mentions, and those who
 * already wrote in its thread. Decided once, here:
 *
 * - nobody is told about their own comment;
 * - nobody is told about a project they cannot see *now* — a mention of someone
 *   without access is dropped, and says nothing about whether they exist;
 * - a mention reaches its person whether or not they follow the project (it is
 *   an address, not a subscription); a person both mentioned and in the thread
 *   gets the mention alone.
 *
 * The notification holds names (author, table, column), never the comment's
 * text. Never throws: a notification is a courtesy, not part of the comment.
 * Answers how many people were told.
 */
export function notifyCommentAddressees(
  projectId: string,
  actor: { id: string; displayName: string },
  notice: CommentNotice,
): number {
  try {
    const mentioned = extractMentionedUserIds(notice.text);
    const recipients = new Map<string, DirectNotificationEvent>();
    for (const id of notice.threadUserIds) recipients.set(id, "reply");
    for (const id of mentioned) recipients.set(id, "mention");
    recipients.delete(actor.id);

    const params = JSON.stringify({ by: actor.displayName, table: notice.tableName, column: notice.columnName });
    const exists = db.prepare("SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL");
    const insert = db.prepare(
      "INSERT INTO notifications (id, user_id, project_id, event, params_json) VALUES (?, ?, ?, ?, ?)",
    );
    const trim = db.prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
         (SELECT id FROM notifications WHERE user_id = ? ORDER BY rowid DESC LIMIT ${KEPT_PER_USER})`,
    );
    const told = new Set<string>();
    for (const [userId, event] of recipients) {
      if (!exists.get(userId) || !getEffectivePermission(userId, projectId)) continue;
      insert.run(crypto.randomUUID(), userId, projectId, event, params);
      trim.run(userId, userId);
      told.add(userId);
    }
    // Those with the project open learn it now; no one else in the room learns who was addressed.
    notifyProjectUsers(projectId, told, { type: "notification" });
    return told.size;
  } catch (err) {
    console.error("[notifications] could not notify comment addressees:", err);
    return 0;
  }
}
