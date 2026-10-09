import { db } from "../infrastructure/db.js";

/**
 * What a grant gives on a project, each level including the ones before it:
 * `view` reads, `edit` changes the schema, `deploy` also plans, deploys and
 * rolls back to the project's databases (and reads their history), and
 * `administrator` also decides who has access, the connections, the locks,
 * the webhooks, the lint rules and the watch.
 */
export type PermissionLevel = "view" | "edit" | "deploy" | "administrator";

const RANK: Record<PermissionLevel, number> = { view: 1, edit: 2, deploy: 3, administrator: 4 };
const LEVELS: PermissionLevel[] = ["view", "edit", "deploy", "administrator"];

/** `level` gives at least what `min` gives. */
export function permissionAtLeast(level: PermissionLevel, min: PermissionLevel): boolean {
  return RANK[level] >= RANK[min];
}

export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return typeof value === "string" && (LEVELS as string[]).includes(value);
}

interface ProjectOwnerRow {
  owner_id: string | null;
}

interface UserAdminRow {
  is_admin: number;
}

interface GrantRow {
  permission: PermissionLevel;
}

export function isGlobalAdmin(userId: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as UserAdminRow | undefined;
  return row?.is_admin === 1;
}

/**
 * A project with zero teams and zero people assigned defaults to `view` for
 * every logged-in user; assigning even one flips it from open to restricted —
 * only those teams' members and those people (at their granted level), the
 * project's creator, and global admins can see it. Global admins and the
 * creator always get an unconditional `administrator` regardless of grants.
 * A person's own grant and their teams' add up: the highest wins.
 */
export function getEffectivePermission(userId: string, projectId: string): PermissionLevel | null {
  if (isGlobalAdmin(userId)) return "administrator";

  const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(projectId) as
    ProjectOwnerRow | undefined;
  if (!project) return null;
  if (project.owner_id === userId) return "administrator";

  const grants = db
    .prepare(
      `SELECT pt.permission AS permission
       FROM project_teams pt
       JOIN team_members tm ON tm.team_id = pt.team_id
       WHERE pt.project_id = ? AND tm.user_id = ?
       UNION ALL
       SELECT permission FROM project_members WHERE project_id = ? AND user_id = ?`,
    )
    .all(projectId, userId, projectId, userId) as GrantRow[];

  if (grants.length > 0) {
    return grants.reduce((best, g) => (RANK[g.permission] > RANK[best] ? g.permission : best), grants[0].permission);
  }

  const restricted = db
    .prepare(
      `SELECT 1 FROM project_teams WHERE project_id = ?
       UNION ALL
       SELECT 1 FROM project_members WHERE project_id = ? LIMIT 1`,
    )
    .get(projectId, projectId);
  return restricted ? null : "view";
}

export function hasPermission(userId: string, projectId: string, min: PermissionLevel): boolean {
  const level = getEffectivePermission(userId, projectId);
  return level !== null && permissionAtLeast(level, min);
}

/** May plan, deploy and roll back on the project: `deploy` or `administrator`. */
export function canDeployProject(userId: string, projectId: string): boolean {
  return hasPermission(userId, projectId, "deploy");
}

export function canManageProject(userId: string, projectId: string): boolean {
  return getEffectivePermission(userId, projectId) === "administrator";
}
