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

export function listUsers(): UserRow[] {
  return db
    .prepare("SELECT id, email, is_admin, display_name, created_at, disabled_at FROM users ORDER BY created_at ASC")
    .all() as UserRow[];
}

export function getUserIdentity(id: string): UserIdentityRow | undefined {
  return db.prepare("SELECT id, email FROM users WHERE id = ?").get(id) as UserIdentityRow | undefined;
}

export function getUserAccount(id: string): UserRow | undefined {
  return db
    .prepare("SELECT id, email, is_admin, display_name, created_at, disabled_at FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
}

export function getPasswordHash(userId: string): string | undefined {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as
    { password_hash: string } | undefined;
  return row?.password_hash;
}

export function userExists(id: string): boolean {
  return db.prepare("SELECT 1 FROM users WHERE id = ?").get(id) !== undefined;
}

export function updateDisplayName(userId: string, displayName: string): void {
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
}

export function updatePasswordHash(userId: string, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function deleteUserSessions(userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

const disableUserTx = db.transaction((userId: string) => {
  db.prepare("UPDATE users SET disabled_at = datetime('now') WHERE id = ?").run(userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
});

/** Disabling also drops the account's sessions — leaving them alive would mean a disabled account keeps working. */
export function disableUser(userId: string): void {
  disableUserTx(userId);
}

export function enableUser(userId: string): void {
  db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(userId);
}

export function countProjectsOwnedBy(userId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?").get(userId) as { n: number };
  return row.n;
}

export function countOtherActiveAdmins(excludingUserId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled_at IS NULL AND id != ?")
    .get(excludingUserId) as { n: number };
  return row.n;
}

export function isAdminUser(userId: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as { is_admin: number } | undefined;
  return row?.is_admin === 1;
}

const purgeUserAndBelongingsTx = db.transaction((userId: string, email: string, transferTo: string | null) => {
  db.prepare("UPDATE projects SET owner_id = ? WHERE owner_id = ?").run(transferTo, userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM team_members WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM invitations WHERE invited_by = ? AND accepted_at IS NULL").run(userId);
  db.prepare("DELETE FROM login_attempts WHERE email = ?").run(email);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});

export function purgeUserAndBelongings(userId: string, email: string, transferTo: string | null): void {
  purgeUserAndBelongingsTx(userId, email, transferTo);
}

export function listTeamMembershipsOf(userId: string) {
  return db
    .prepare(
      `SELECT t.id, t.name, tm.created_at AS joinedAt
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = ? ORDER BY t.name`,
    )
    .all(userId);
}

export function listProjectsOwnedBy(userId: string) {
  return db
    .prepare("SELECT id, name, status, created_at AS createdAt FROM projects WHERE owner_id = ? ORDER BY name")
    .all(userId);
}
