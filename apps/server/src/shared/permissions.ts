import { db } from "../infrastructure/db.js";

export type PermissionLevel = "view" | "edit" | "administrator";

const RANK: Record<PermissionLevel, number> = { view: 1, edit: 2, administrator: 3 };
const LEVELS: PermissionLevel[] = ["view", "edit", "administrator"];

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

function isGlobalAdmin(userId: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as UserAdminRow | undefined;
  return row?.is_admin === 1;
}

/**
 * A project with zero teams assigned defaults to `view` for every logged-in
 * user; assigning even one team flips it from open to restricted — only that
 * team's members (at their granted level), the project's creator, and global
 * admins can see it. Global admins and the creator always get an
 * unconditional `administrator` regardless of team state.
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
       WHERE pt.project_id = ? AND tm.user_id = ?`,
    )
    .all(projectId, userId) as GrantRow[];

  if (grants.length > 0) {
    return grants.reduce((best, g) => (RANK[g.permission] > RANK[best] ? g.permission : best), grants[0].permission);
  }

  const hasAnyTeam = db.prepare("SELECT 1 FROM project_teams WHERE project_id = ? LIMIT 1").get(projectId);
  return hasAnyTeam ? null : "view";
}

export function hasPermission(userId: string, projectId: string, min: PermissionLevel): boolean {
  const level = getEffectivePermission(userId, projectId);
  return level !== null && RANK[level] >= RANK[min];
}

export function canManageProject(userId: string, projectId: string): boolean {
  return getEffectivePermission(userId, projectId) === "administrator";
}
