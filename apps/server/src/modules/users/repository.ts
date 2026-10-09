import { deleteConnection } from "../connections/repository.js";
import { db } from "../../infrastructure/db.js";

export interface UserRow {
  id: string;
  email: string;
  is_admin: number;
  display_name: string | null;
  created_at: string;
  disabled_at: string | null;
}

export interface UserIdentityRow {
  id: string;
  email: string;
}

export async function listUsers(): Promise<UserRow[]> {
  return (await db
    .prepare("SELECT id, email, is_admin, display_name, created_at, disabled_at FROM users ORDER BY created_at ASC")
    .all()) as UserRow[];
}

export async function getUserIdentity(id: string): Promise<UserIdentityRow | undefined> {
  return (await db.prepare("SELECT id, email FROM users WHERE id = ?").get(id)) as UserIdentityRow | undefined;
}

export async function getUserAccount(id: string): Promise<UserRow | undefined> {
  return (await db
    .prepare("SELECT id, email, is_admin, display_name, created_at, disabled_at FROM users WHERE id = ?")
    .get(id)) as UserRow | undefined;
}

export async function getPasswordHash(userId: string): Promise<string | undefined> {
  const row = (await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId)) as
    { password_hash: string } | undefined;
  return row?.password_hash;
}

export async function userExists(id: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) !== undefined;
}

export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  await db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

const disableUserTx = async (userId: string) =>
  await db.transaction(async () => {
    await db.prepare("UPDATE users SET disabled_at = utc_now() WHERE id = ?").run(userId);
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  });

/** Disabling also drops the account's sessions — leaving them alive would mean a disabled account keeps working. */
export async function disableUser(userId: string): Promise<void> {
  await disableUserTx(userId);
}

export async function enableUser(userId: string): Promise<void> {
  await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(userId);
}

export async function setUserAdmin(userId: string, admin: boolean): Promise<void> {
  await db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(admin ? 1 : 0, userId);
}

export async function countProjectsOwnedBy(userId: string): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?").get(userId)) as { n: number };
  return row.n;
}

export async function countOtherActiveAdmins(excludingUserId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled_at IS NULL AND id != ?")
    .get(excludingUserId)) as { n: number };
  return row.n;
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const row = (await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId)) as
    { is_admin: number } | undefined;
  return row?.is_admin === 1;
}

const purgeUserAndBelongingsTx = async (userId: string, email: string, transferTo: string | null) =>
  await db.transaction(async () => {
    await db.prepare("UPDATE projects SET owner_id = ? WHERE owner_id = ?").run(transferTo, userId);
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM team_members WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM project_members WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM subscriptions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM notifications WHERE user_id = ?").run(userId);
    for (const row of (await db.prepare("SELECT id FROM db_connections WHERE owner_user_id = ?").all(userId)) as {
      id: string;
    }[])
      await deleteConnection(row.id);
    await db.prepare("DELETE FROM db_connection_credentials WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM db_access_grants WHERE subject_type = 'user' AND subject_id = ?").run(userId);
    await db.prepare("DELETE FROM db_account_hints WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM invitations WHERE invited_by = ? AND accepted_at IS NULL").run(userId);
    await db.prepare("DELETE FROM login_attempts WHERE email = ?").run(email);
    await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

export async function purgeUserAndBelongings(userId: string, email: string, transferTo: string | null): Promise<void> {
  await purgeUserAndBelongingsTx(userId, email, transferTo);
}

export async function listTeamMembershipsOf(userId: string) {
  return await db
    .prepare(
      `SELECT t.id, t.name, tm.created_at AS "joinedAt"
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = ? ORDER BY t.name`,
    )
    .all(userId);
}

export async function listProjectsOwnedBy(userId: string) {
  return await db
    .prepare(`SELECT id, name, status, created_at AS "createdAt" FROM projects WHERE owner_id = ? ORDER BY name`)
    .all(userId);
}
