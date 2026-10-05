/**
 * `@mentions` in comments.
 *
 * A comment's text is stored in the shared document, so a mention must survive
 * a rename and cannot rest on the display name alone: it is stored as the
 * token `@[Display name](account-id)`. The name is only what was shown when it
 * was written; the id is what the server notifies (after checking, at that
 * moment, that the account can still see the project).
 */

/** Most accounts one comment can address — beyond that, a mention is just text. */
export const MAX_MENTIONS_PER_COMMENT = 20;
/** Longest name a mention token carries. */
export const MAX_MENTION_NAME_LENGTH = 80;

const TOKEN = new RegExp(String.raw`@\[([^\]\[\n()]{1,${MAX_MENTION_NAME_LENGTH}})\]\(([A-Za-z0-9_-]{1,64})\)`, "g");

export type CommentSegment = { type: "text"; text: string } | { type: "mention"; userId: string; name: string };

/** What goes into the document for one mention. The name loses the characters that would break the token. */
export function formatMention(name: string, userId: string): string {
  const clean = name
    .replace(/[[\]()\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MENTION_NAME_LENGTH);
  return `@[${clean || "?"}](${userId})`;
}

/** A comment's text cut into plain runs and mentions, in order. */
export function parseCommentText(text: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ type: "text", text: text.slice(last, at) });
    segments.push({ type: "mention", userId: match[2], name: match[1] });
    last = at + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

/** The accounts a comment addresses: each once, in order, capped at `MAX_MENTIONS_PER_COMMENT`. */
export function extractMentionedUserIds(text: string): string[] {
  const ids: string[] = [];
  for (const segment of parseCommentText(text)) {
    if (segment.type === "mention" && !ids.includes(segment.userId)) ids.push(segment.userId);
  }
  return ids.slice(0, MAX_MENTIONS_PER_COMMENT);
}

/** The comment as plain text — what a place that cannot highlight (a clipboard, an export) shows. */
export function plainCommentText(text: string): string {
  return parseCommentText(text)
    .map((segment) => (segment.type === "mention" ? `@${segment.name}` : segment.text))
    .join("");
}

/**
 * Turns what the author typed (`@Alice Martin` picked from the list) into
 * what is stored. Only names the author actually picked become mentions, and
 * only where `@` starts a word and the name ends one — typing "@alice" by
 * hand mentions nobody.
 */
export function storeMentions(draft: string, picked: readonly { id: string; name: string }[]): string {
  let result = draft;
  const byLength = [...picked].sort((a, b) => b.name.length - a.name.length);
  for (const { id, name } of byLength) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const pattern = new RegExp(String.raw`(^|[\s(])@${escaped}(?![\p{L}\p{N}_])`, "gu");
    // A function replacer: the token holds `$`-free text, but never let a name be read as a pattern.
    result = result.replace(pattern, (_all, before: string) => `${before}${formatMention(name, id)}`);
  }
  return result;
}
