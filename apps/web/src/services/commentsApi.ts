import { request } from "./httpClient";

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
