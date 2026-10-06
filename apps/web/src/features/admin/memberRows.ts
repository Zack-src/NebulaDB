import type { InvitationSummary, UserSummary } from "@/types";

export interface MemberRow {
  id: string;
  user: UserSummary | null;
  invitation: InvitationSummary | null;
}

/** One person per email: an accepted invitation joins its account instead of making a second row. */
export function memberRows(users: UserSummary[], invitations: InvitationSummary[]): MemberRow[] {
  const emailKey = (email: string) => email.trim().toLowerCase();
  const latest = new Map<string, InvitationSummary>();
  for (const invitation of invitations) {
    const key = emailKey(invitation.email);
    const previous = latest.get(key);
    if (!previous || invitation.createdAt > previous.createdAt) latest.set(key, invitation);
  }
  const rows: MemberRow[] = users.map((user) => {
    const key = emailKey(user.email);
    const invitation = latest.get(key) ?? null;
    latest.delete(key);
    return { id: "user:" + user.id, user, invitation: invitation?.status === "accepted" ? invitation : null };
  });
  for (const invitation of latest.values()) rows.push({ id: "invite:" + invitation.token, user: null, invitation });
  return rows.sort((a, b) =>
    (b.user?.createdAt ?? b.invitation!.createdAt).localeCompare(a.user?.createdAt ?? a.invitation!.createdAt),
  );
}
