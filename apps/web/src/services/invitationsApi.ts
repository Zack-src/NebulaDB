import type { InvitationSummary, Session } from "@/types";
import { request } from "./httpClient";

export interface CreatedInvitation {
  token: string;
  inviteUrl: string;
  email: string;
  expiresAt: string;
}

export function fetchInvitations(): Promise<InvitationSummary[]> {
  return request<InvitationSummary[]>("/api/invitations");
}

export function createInvitation(email: string, isAdmin: boolean): Promise<CreatedInvitation> {
  return request<CreatedInvitation>("/api/invitations", { method: "POST", body: { email, isAdmin } });
}

export function revokeInvitation(token: string): Promise<void> {
  return request<void>(`/api/invitations/${token}`, { method: "DELETE" });
}

/** Public: creates the account the invitation was issued for and logs it in. */
export function acceptInvitation(token: string, password: string): Promise<Session> {
  return request<Session>(`/api/invitations/${token}/accept`, { method: "POST", body: { password } });
}
