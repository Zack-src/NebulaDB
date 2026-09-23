import type { InvitationSummary } from "@/types";
import { request } from "./httpClient";

export interface CreatedInvitation {
  token: string;
  inviteUrl: string;
  email: string;
  expiresAt: string;
  /** False when the instance has no email configured, or the send failed — the link then has to be passed on by hand. */
  emailSent: boolean;
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

/**
 * Public: creates the account the invitation was issued for. Deliberately
 * does not log the user in — the caller sends them to the real login form
 * for their first sign-in (see AcceptInvite), so the browser's password
 * manager gets a genuine username+password submission to save.
 */
export function acceptInvitation(token: string, password: string): Promise<{ email: string }> {
  return request<{ email: string }>(`/api/invitations/${token}/accept`, { method: "POST", body: { password } });
}
