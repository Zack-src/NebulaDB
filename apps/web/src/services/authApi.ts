import type { Session, SessionSummary } from "@/types";
import { request } from "./httpClient";

export interface LoginPayload {
  email: string;
  password: string;
  remember: boolean;
}

export function login(payload: LoginPayload): Promise<Session> {
  return request<Session>("/api/auth/login", { method: "POST", body: payload });
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function fetchCurrentSession(): Promise<Session> {
  return request<Session>("/api/auth/me");
}

export function fetchActiveSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>("/api/auth/sessions");
}

export function revokeSession(sessionId: string): Promise<void> {
  return request<void>(`/api/auth/sessions/${sessionId}`, { method: "DELETE" });
}

export function revokeOtherSessions(): Promise<{ revoked: number }> {
  return request<{ revoked: number }>("/api/auth/sessions/revoke-others", { method: "POST" });
}
