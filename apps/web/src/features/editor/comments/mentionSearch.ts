import { fetchMentionable } from "@/services/commentsApi";
import { commentsSession } from "./commentsSession";
import type { MentionableUser } from "./commentNotice";

/** What the composers' `@` list asks: the people who can see the open project and match what was typed. */
export function searchMentionable(query: string, signal: AbortSignal): Promise<MentionableUser[]> {
  const session = commentsSession.get();
  return session ? fetchMentionable(session.projectId, query, signal) : Promise.resolve([]);
}
