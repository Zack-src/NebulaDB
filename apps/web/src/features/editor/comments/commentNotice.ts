import { extractMentionedUserIds, type Comment, type Table } from "@athanordb/shared";

export interface MentionableUser {
  id: string;
  name: string;
}

export interface CommentNoticeBody {
  text: string;
  tableName: string;
  columnName: string | null;
  threadUserIds: string[];
}

/**
 * What the server needs to tell a comment's addressees: the text (it reads the
 * mentions itself), the table and column it is about, and who already wrote in
 * the thread. `null` when nobody can be addressed — no mention, no earlier
 * author but the writer — so that no request is made for an ordinary comment.
 */
export function buildCommentNotice(
  table: Table,
  comment: Comment,
  authorId: string | undefined,
): CommentNoticeBody | null {
  const earlier = (table.comments ?? []).filter((c) => c.id !== comment.id && c.fieldId === comment.fieldId);
  const threadUserIds = [...new Set(earlier.map((c) => c.authorId).filter((id): id is string => !!id))].filter(
    (id) => id !== authorId,
  );
  const mentioned = extractMentionedUserIds(comment.text).filter((id) => id !== authorId);
  if (threadUserIds.length === 0 && mentioned.length === 0) return null;
  const column = comment.fieldId ? table.fields.find((field) => field.id === comment.fieldId)?.name : undefined;
  return { text: comment.text, tableName: table.name, columnName: column ?? null, threadUserIds };
}

/** What a stored mention adds to a comment over the `@Name` typed: `[`, `](`, `)` and the account id. */
const MENTION_OVERHEAD = 50;

/** How long the draft may be, so that it is still within the limit once its mentions are stored as tokens. */
export function commentDraftLimit(maxStored: number, pickedCount: number): number {
  return Math.max(200, maxStored - pickedCount * MENTION_OVERHEAD);
}
