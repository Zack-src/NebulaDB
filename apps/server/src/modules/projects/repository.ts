import { db } from "../../infrastructure/db.js";

export type ProjectStatus = "active" | "archived" | "trashed";

export const PROJECT_STATUSES: ProjectStatus[] = ["active", "archived", "trashed"];

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as string[]).includes(value);
}

export interface ProjectRow {
  id: string;
  name: string;
  owner_id: string | null;
}

export interface ProjectSummaryRow {
  id: string;
  name: string;
  status: ProjectStatus;
  created_at: string;
}

export interface ProjectTeamGrantRow {
  teamId: string;
  teamName: string;
  permission: string;
}

export function getProjectRow(id: string): ProjectRow | undefined {
  return db.prepare("SELECT id, name, owner_id FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function getProjectSummary(id: string): ProjectSummaryRow | undefined {
  return db.prepare("SELECT id, name, status, created_at FROM projects WHERE id = ?").get(id) as
    | ProjectSummaryRow
    | undefined;
}

export function listProjectSummaries(): ProjectSummaryRow[] {
  return db
    .prepare("SELECT id, name, status, created_at FROM projects ORDER BY created_at DESC")
    .all() as ProjectSummaryRow[];
}

export function countProjectsOwnedBy(userId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?").get(userId) as { n: number };
  return row.n;
}

export function insertProject(id: string, name: string, ownerId: string): void {
  db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, ?, ?)").run(id, name, ownerId);
}

export function updateProjectName(id: string, name: string): void {
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
}

export function updateProjectStatus(id: string, status: ProjectStatus): void {
  db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, id);
}

/** Removes the project and everything that references it — revisions, snapshots, team grants. */
export function deleteProjectCascade(id: string): void {
  db.prepare("DELETE FROM project_teams WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM revisions WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM snapshots WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function teamExists(teamId: string): boolean {
  return db.prepare("SELECT 1 FROM teams WHERE id = ?").get(teamId) !== undefined;
}

export function listProjectTeams(projectId: string): ProjectTeamGrantRow[] {
  return db
    .prepare(
      `SELECT pt.team_id AS teamId, t.name AS teamName, pt.permission AS permission
       FROM project_teams pt JOIN teams t ON t.id = pt.team_id
       WHERE pt.project_id = ?
       ORDER BY t.name ASC`,
    )
    .all(projectId) as ProjectTeamGrantRow[];
}

export function grantTeamPermission(projectId: string, teamId: string, permission: string): void {
  db.prepare(
    `INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)
     ON CONFLICT(project_id, team_id) DO UPDATE SET permission = excluded.permission`,
  ).run(projectId, teamId, permission);
}

export function revokeTeamPermission(projectId: string, teamId: string): void {
  db.prepare("DELETE FROM project_teams WHERE project_id = ? AND team_id = ?").run(projectId, teamId);
}
