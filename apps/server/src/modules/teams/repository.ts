import { db } from "../../infrastructure/db.js";

export interface TeamRow {
  id: string;
  name: string;
  created_at: string;
}

export interface TeamMemberRow {
  id: string;
  email: string;
  is_admin: number;
  display_name: string | null;
}

export function listTeamsWithMemberCount(): (TeamRow & { member_count: number })[] {
  return db
    .prepare(
      `SELECT t.id, t.name, t.created_at, COUNT(tm.user_id) AS member_count
       FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
       GROUP BY t.id ORDER BY t.name ASC`,
    )
    .all() as (TeamRow & { member_count: number })[];
}

export function getTeam(id: string): TeamRow | undefined {
  return db.prepare("SELECT id, name, created_at FROM teams WHERE id = ?").get(id) as TeamRow | undefined;
}

export function listTeamMembers(teamId: string): TeamMemberRow[] {
  return db
    .prepare(
      `SELECT u.id, u.email, u.is_admin, u.display_name
       FROM team_members tm JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ? ORDER BY u.email ASC`,
    )
    .all(teamId) as TeamMemberRow[];
}

export function insertTeam(id: string, name: string): void {
  db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(id, name);
}

export function updateTeamName(id: string, name: string): void {
  db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(name, id);
}

/** No FK cascade in this SQLite setup — dependents go first, same ordering the project hard-delete uses. */
const deleteTeamCascadeTx = db.transaction((teamId: string) => {
  db.prepare("DELETE FROM project_teams WHERE team_id = ?").run(teamId);
  db.prepare("DELETE FROM team_members WHERE team_id = ?").run(teamId);
  db.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
});

export function deleteTeamCascade(teamId: string): void {
  deleteTeamCascadeTx(teamId);
}

export function userExists(userId: string): boolean {
  return db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId) !== undefined;
}

export function addTeamMember(teamId: string, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
}

export function removeTeamMember(teamId: string, userId: string): void {
  db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(teamId, userId);
}
