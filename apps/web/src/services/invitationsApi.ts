import type { InvitationGrants } from "@nebuladb/shared";
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

/** `grants`: teams to join and database access, applied by the server the moment the invitation is accepted. */
export function createInvitation(
  email: string,
  isAdmin: boolean,
  grants: InvitationGrants = { teamIds: [], databases: [] },
): Promise<CreatedInvitation> {
  return request<CreatedInvitation>("/api/invitations", { method: "POST", body: { email, isAdmin, ...grants } });
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
