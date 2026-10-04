import type { NotificationEvent, ProjectSubscription, UserNotification } from "@athanordb/shared";
import { request } from "./httpClient";

export interface Inbox {
  notifications: UserNotification[];
  unread: number;
}

export function fetchInbox(): Promise<Inbox> {
  return request<Inbox>("/api/notifications");
}

/** Marks these notifications as read — or all of them, without `ids`. Answers the inbox as it is afterwards. */
export function markNotificationsRead(ids?: string[]): Promise<Inbox> {
  return request<Inbox>("/api/notifications/read", { method: "POST", body: ids ? { ids } : {} });
}

export async function fetchProjectSubscription(projectId: string): Promise<ProjectSubscription | null> {
  return (await request<{ subscription: ProjectSubscription | null }>(`/api/projects/${projectId}/subscription`))
    .subscription;
}

/** Follows these events on the project; an empty list stops following. */
export async function saveProjectSubscription(
  projectId: string,
  events: NotificationEvent[],
): Promise<ProjectSubscription | null> {
  return (
    await request<{ subscription: ProjectSubscription | null }>(`/api/projects/${projectId}/subscription`, {
      method: "PUT",
      body: { events },
    })
  ).subscription;
}
