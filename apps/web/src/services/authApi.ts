import type { Session, SessionSummary } from "@/types";
import { request } from "./httpClient";

export interface LoginPayload {
  email: string;
  password: string;
  remember: boolean;
}

/** The password step was correct but the account has 2FA enabled — `mfaToken` identifies the pending challenge for `verifyTotpLogin`. */
export interface MfaRequired {
  mfaRequired: true;
  mfaToken: string;
}

export type LoginResult = Session | MfaRequired;

export function login(payload: LoginPayload): Promise<LoginResult> {
  return request<LoginResult>("/api/auth/login", { method: "POST", body: payload });
}

/** Second step of a 2FA login — `code` is either a live TOTP code or a backup code. */
export function verifyTotpLogin(mfaToken: string, code: string): Promise<Session> {
  return request<Session>("/api/auth/login/totp", { method: "POST", body: { mfaToken, code } });
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

export interface TotpStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
}

export interface TotpConfirmResult {
  enabled: true;
  backupCodes: string[];
}

export function fetchTotpStatus(): Promise<TotpStatus> {
  return request<TotpStatus>("/api/auth/totp/status");
}

export function startTotpSetup(): Promise<TotpSetup> {
  return request<TotpSetup>("/api/auth/totp/setup", { method: "POST", body: {} });
}

export function confirmTotpSetup(code: string): Promise<TotpConfirmResult> {
  return request<TotpConfirmResult>("/api/auth/totp/confirm", { method: "POST", body: { code } });
}

export function disableTotp(password: string, code: string): Promise<{ enabled: false }> {
  return request<{ enabled: false }>("/api/auth/totp/disable", { method: "POST", body: { password, code } });
}

export function regenerateBackupCodes(password: string): Promise<{ backupCodes: string[] }> {
  return request<{ backupCodes: string[] }>("/api/auth/totp/regenerate-backup-codes", {
    method: "POST",
    body: { password },
  });
}
