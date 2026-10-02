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
    ProjectSummaryRow | undefined;
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

/**
 * Removes the project and everything that references it, explicitly and in
 * one transaction rather than leaning on the schema's `ON DELETE CASCADE`
 * clauses: several of the referencing tables (`revisions`, `snapshots`,
 * `project_teams`) declare no cascade at all, and what must happen to a
 * connection is not a cascade anyway — see below.
 */
export function deleteProjectCascade(id: string): void {
  db.transaction(() => {
    db.prepare(
      "DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM project_webhooks WHERE project_id = ?)",
    ).run(id);
    db.prepare("DELETE FROM project_webhooks WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM deployment_history WHERE project_id = ?").run(id);
    // Connections are instance-level since migration 18: only the link goes, plus
    // any connection this project created that is now attached to nothing.
    db.prepare("DELETE FROM project_connection_links WHERE project_id = ?").run(id);
    db.prepare(
      `DELETE FROM db_connections
        WHERE origin = 'project'
          AND NOT EXISTS (SELECT 1 FROM project_connection_links l WHERE l.connection_id = db_connections.id)`,
    ).run();
    db.prepare("DELETE FROM api_keys WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM project_teams WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM revisions WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM snapshots WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  })();
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
