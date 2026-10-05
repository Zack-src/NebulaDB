import type { MentionableUser, CommentNoticeBody } from "@/features/editor/comments/commentNotice";
import { request } from "./httpClient";

/** Who `@` may offer on this project: accounts that can see it, filtered by what was typed. */
export async function fetchMentionable(
  projectId: string,
  query: string,
  signal?: AbortSignal,
): Promise<MentionableUser[]> {
  return (
    await request<{ users: MentionableUser[] }>(`/api/projects/${projectId}/mentionable`, {
      query: { q: query },
      signal,
    })
  ).users;
}

/** Says a comment was just written; the server decides who is told. */
export function postCommentNotice(projectId: string, notice: CommentNoticeBody): Promise<{ notified: number }> {
  return request<{ notified: number }>(`/api/projects/${projectId}/comment-notices`, {
    method: "POST",
    body: notice,
  });
}
