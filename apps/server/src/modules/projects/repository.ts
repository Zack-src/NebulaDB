import { db } from "../../infrastructure/db.js";

export type ProjectStatus = "active" | "archived" | "trashed";

const PROJECT_STATUSES: ProjectStatus[] = ["active", "archived", "trashed"];

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

export async function getProjectRow(id: string): Promise<ProjectRow | undefined> {
  return (await db.prepare("SELECT id, name, owner_id FROM projects WHERE id = ?").get(id)) as ProjectRow | undefined;
}

export async function getProjectSummary(id: string): Promise<ProjectSummaryRow | undefined> {
  return (await db.prepare("SELECT id, name, status, created_at FROM projects WHERE id = ?").get(id)) as
    ProjectSummaryRow | undefined;
}

export async function listProjectSummaries(): Promise<ProjectSummaryRow[]> {
  return (await db
    .prepare("SELECT id, name, status, created_at FROM projects ORDER BY created_at DESC")
    .all()) as ProjectSummaryRow[];
}

export async function countProjectsOwnedBy(userId: string): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?").get(userId)) as { n: number };
  return row.n;
}

export async function insertProject(id: string, name: string, ownerId: string): Promise<void> {
  await db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, ?, ?)").run(id, name, ownerId);
}

export async function updateProjectName(id: string, name: string): Promise<void> {
  await db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
}

export async function updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
  await db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, id);
}

/**
 * Removes the project and everything that references it, explicitly and in
 * one transaction rather than leaning on the schema's `ON DELETE CASCADE`
 * clauses: several of the referencing tables (`revisions`, `snapshots`,
 * `project_teams`) declare no cascade at all, and what must happen to a
 * connection is not a cascade anyway — see below.
 */
export async function deleteProjectCascade(id: string): Promise<void> {
  await db.transaction(async () => {
    await db
      .prepare(
        "DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM project_webhooks WHERE project_id = ?)",
      )
      .run(id);
    await db.prepare("DELETE FROM project_webhooks WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM deployment_history WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM deployment_reviews WHERE project_id = ?").run(id);
    // Connections are instance-level since migration 18: only the link goes, plus
    // any connection this project created that is now attached to nothing.
    await db.prepare("DELETE FROM project_connection_links WHERE project_id = ?").run(id);
    await db
      .prepare(
        `DELETE FROM db_connections
        WHERE origin = 'project'
          AND NOT EXISTS (SELECT 1 FROM project_connection_links l WHERE l.connection_id = db_connections.id)`,
      )
      .run();
    // What was granted on a connection that just went with the project.
    await db.prepare("DELETE FROM db_access_grants WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
    await db.prepare("DELETE FROM db_account_hints WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
    await db.prepare("DELETE FROM api_keys WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM table_locks WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM table_seeds WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM generator_configs WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM monitor_settings WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM lint_settings WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM subscriptions WHERE scope_type = 'project' AND scope_id = ?").run(id);
    await db.prepare("DELETE FROM notifications WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM drift_events WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM account_baselines WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM schema_fingerprints WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM project_teams WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM project_members WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM revisions WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM snapshots WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
}

export async function teamExists(teamId: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM teams WHERE id = ?").get(teamId)) !== undefined;
}

export async function listProjectTeams(projectId: string): Promise<ProjectTeamGrantRow[]> {
  return (await db
    .prepare(
      `SELECT pt.team_id AS "teamId", t.name AS "teamName", pt.permission AS permission
       FROM project_teams pt JOIN teams t ON t.id = pt.team_id
       WHERE pt.project_id = ?
       ORDER BY t.name ASC`,
    )
    .all(projectId)) as ProjectTeamGrantRow[];
}

export async function grantTeamPermission(projectId: string, teamId: string, permission: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)
     ON CONFLICT(project_id, team_id) DO UPDATE SET permission = excluded.permission`,
    )
    .run(projectId, teamId, permission);
}

export async function revokeTeamPermission(projectId: string, teamId: string): Promise<void> {
  await db.prepare("DELETE FROM project_teams WHERE project_id = ? AND team_id = ?").run(projectId, teamId);
}

export interface ProjectMemberGrantRow {
  userId: string;
  email: string;
  displayName: string;
  permission: string;
}

/** The people given a level on the project themselves — not through a team. */
export async function listProjectMembers(projectId: string): Promise<ProjectMemberGrantRow[]> {
  return (await db
    .prepare(
      `SELECT pm.user_id AS "userId", u.email AS email,
              COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) AS "displayName", pm.permission AS permission
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY u.email ASC`,
    )
    .all(projectId)) as ProjectMemberGrantRow[];
}

export async function grantMemberPermission(
  projectId: string,
  userId: string,
  permission: string,
  grantedBy: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO project_members (project_id, user_id, permission, granted_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET permission = excluded.permission, granted_by = excluded.granted_by`,
    )
    .run(projectId, userId, permission, grantedBy);
}

export async function revokeMemberPermission(projectId: string, userId: string): Promise<void> {
  await db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(projectId, userId);
}

export interface TeamProjectGrantRow {
  projectId: string;
  projectName: string;
  permission: string;
}

/** The projects a team opens, and at what level — the team's side of `listProjectTeams`. */
export async function listTeamProjects(teamId: string): Promise<TeamProjectGrantRow[]> {
  return (await db
    .prepare(
      `SELECT pt.project_id AS "projectId", p.name AS "projectName", pt.permission AS permission
       FROM project_teams pt JOIN projects p ON p.id = pt.project_id
       WHERE pt.team_id = ?
       ORDER BY LOWER(p.name)`,
    )
    .all(teamId)) as TeamProjectGrantRow[];
}

export interface UserProjectAccessRow {
  projectId: string;
  projectName: string;
  /** The level given to the person themselves, if any. */
  permission: string | null;
  owner: boolean;
}

/** The projects a person owns or was given a level on themselves; what their teams give is listed with the teams. */
export async function listUserProjects(userId: string): Promise<UserProjectAccessRow[]> {
  const rows = (await db
    .prepare(
      `SELECT p.id AS "projectId", p.name AS "projectName", pm.permission AS permission,
              CASE WHEN p.owner_id = ? THEN 1 ELSE 0 END AS owner
       FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.owner_id = ? OR pm.user_id IS NOT NULL
       ORDER BY LOWER(p.name)`,
    )
    .all(userId, userId, userId)) as (Omit<UserProjectAccessRow, "owner"> & { owner: number })[];
  return rows.map((row) => ({ ...row, owner: row.owner === 1 }));
}
