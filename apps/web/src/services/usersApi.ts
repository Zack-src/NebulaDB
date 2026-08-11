import type { Session, UserSummary } from "@/types";
import { request } from "./httpClient";

export function fetchUsers(): Promise<UserSummary[]> {
  return request<UserSummary[]>("/api/users");
}

export function updateMyDisplayName(displayName: string): Promise<Session> {
  return request<Session>("/api/users/me", { method: "PATCH", body: { displayName } });
}

export function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  return request<void>("/api/users/me/password", { method: "PATCH", body: { currentPassword, newPassword } });
}

export function deleteMyAccount(password: string): Promise<{ projectsAffected: number }> {
  return request<{ projectsAffected: number }>("/api/users/me", { method: "DELETE", body: { password } });
}

/** The personal-data export is a file download, so it is a link rather than a fetch. */
export const MY_DATA_EXPORT_URL = "/api/users/me/export";

export function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  return request<void>(`/api/users/${userId}/password`, { method: "PATCH", body: { newPassword } });
}

export function setUserDisabled(userId: string, disabled: boolean): Promise<void> {
  return request<void>(`/api/users/${userId}/disabled`, { method: "PATCH", body: { disabled } });
}

export function deleteUser(userId: string, transferProjectsTo?: string): Promise<{ projectsAffected: number }> {
  return request<{ projectsAffected: number }>(`/api/users/${userId}`, {
    method: "DELETE",
    body: transferProjectsTo ? { transferProjectsTo } : {},
  });
}
