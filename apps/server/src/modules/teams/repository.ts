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

export async function listTeamsWithMemberCount(): Promise<(TeamRow & { member_count: number })[]> {
  return (await db
    .prepare(
      `SELECT t.id, t.name, t.created_at, COUNT(tm.user_id) AS member_count
       FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
       GROUP BY t.id ORDER BY t.name ASC`,
    )
    .all()) as (TeamRow & { member_count: number })[];
}

export async function getTeam(id: string): Promise<TeamRow | undefined> {
  return (await db.prepare("SELECT id, name, created_at FROM teams WHERE id = ?").get(id)) as TeamRow | undefined;
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  return (await db
    .prepare(
      `SELECT u.id, u.email, u.is_admin, u.display_name
       FROM team_members tm JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ? ORDER BY u.email ASC`,
    )
    .all(teamId)) as TeamMemberRow[];
}

export async function insertTeam(id: string, name: string): Promise<void> {
  await db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(id, name);
}

export async function updateTeamName(id: string, name: string): Promise<void> {
  await db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(name, id);
}

/** No FK cascade on these tables — dependents go first, same ordering the project hard-delete uses. */
const deleteTeamCascadeTx = async (teamId: string) =>
  await db.transaction(async () => {
    await db.prepare("DELETE FROM project_teams WHERE team_id = ?").run(teamId);
    await db.prepare("DELETE FROM db_access_grants WHERE subject_type = 'team' AND subject_id = ?").run(teamId);
    await db.prepare("DELETE FROM team_members WHERE team_id = ?").run(teamId);
    await db.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
  });

export async function deleteTeamCascade(teamId: string): Promise<void> {
  await deleteTeamCascadeTx(teamId);
}

export async function userExists(userId: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) !== undefined;
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  await db
    .prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .run(teamId, userId);
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(teamId, userId);
}
