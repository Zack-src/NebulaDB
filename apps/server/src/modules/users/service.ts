import { listSubscriptionsOf } from "../notifications/repository.js";
import { listPersonalCredentialsOf } from "../connections/personalCredentials.js";
import type { FastifyRequest } from "fastify";
import { listAuditLog } from "../../shared/audit.js";
import { listSessions } from "../auth/session.js";
import {
  countOtherActiveAdmins,
  countProjectsOwnedBy,
  getUserAccount,
  isAdminUser,
  listProjectsOwnedBy,
  listTeamMembershipsOf,
  purgeUserAndBelongings,
  type UserRow,
} from "./repository.js";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

/** The public shape of a user — never includes the password hash. */
export function toUserSummary(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === 1,
    displayName: row.display_name?.trim() || row.email.split("@")[0],
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

/**
 * Refuses an action that would remove the last account able to administer the
 * instance. Without this, disabling or deleting the only admin leaves an
 * installation with no way back in short of editing the database by hand.
 */
export async function wouldRemoveLastAdmin(userId: string): Promise<boolean> {
  if (!(await isAdminUser(userId))) return false;
  return (await countOtherActiveAdmins(userId)) === 0;
}

/**
 * Runs `change` — disabling, demoting or deleting `userId` — unless that
 * would leave nobody to administer the instance, in which case it throws
 * `refusal` and changes nothing.
 *
 * The check and the change are one transaction holding the administrators'
 * rows: two administrators removing each other at the same moment would
 * otherwise each see the other still there, and both go through.
 */
export async function unlessLastAdmin<T>(
  userId: string,
  refusal: "LAST_ADMIN" | "LAST_ADMIN_SELF",
  change: () => Promise<T>,
): Promise<T> {
  return db.transaction(async () => {
    await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND disabled_at IS NULL ORDER BY id FOR UPDATE").all();
    if (await wouldRemoveLastAdmin(userId)) throw new ApiError(refusal);
    return change();
  });
}

/**
 * Removes an account and everything that belongs to it alone, in one transaction. Shared by
 * the admin and self-service routes. `transferTo` reassigns owned projects; `null` leaves them
 * ownerless. Returns how many projects were affected. Revision authorship is left untouched:
 * it is a display name captured at edit time.
 */
export async function deleteUserAccount(userId: string, email: string, transferTo: string | null): Promise<number> {
  const owned = await countProjectsOwnedBy(userId);
  await purgeUserAndBelongings(userId, email, transferTo);
  return owned;
}

/**
 * Everything the instance holds about one user, as one JSON document.
 *
 * Deliberately assembled from the tables rather than dumped generically:
 * "all my data" has to mean something specific, and a generic dump would
 * either leak other people's rows (team members, project collaborators) or
 * quietly miss a table added later. Password hashes are excluded — they are
 * about the account, not data the user provided, and exporting them creates an
 * offline-cracking artefact for no benefit.
 */
export async function buildPersonalDataExport(userId: string, req: FastifyRequest) {
  const account = (await getUserAccount(userId))!;
  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      isAdmin: account.is_admin === 1,
      createdAt: account.created_at,
      disabledAt: account.disabled_at,
    },
    sessions: await listSessions(userId, req),
    teams: await listTeamMembershipsOf(userId),
    // What the account asked to be told about. The notifications themselves are
    // pointers to events recorded elsewhere (audit trail, deployment history).
    subscriptions: await listSubscriptionsOf(userId),
    // The accounts given on databases that ask each user for their own: names, never passwords.
    databaseAccounts: await listPersonalCredentialsOf(userId),
    ownedProjects: await listProjectsOwnedBy(userId),
    auditTrail: (await listAuditLog({ limit: 500 })).filter((entry) => entry.actorId === userId),
    // Stated rather than silently omitted: schema edits are attributed by
    // display name in each project's own revision log, which is shared
    // content and is not extracted here.
    notIncluded:
      "Schema edits are recorded in each project's revision history under your display name. That history is shared project content, not personal data held about you, and is not part of this export.",
  };
}
