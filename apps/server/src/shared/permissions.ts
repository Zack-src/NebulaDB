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

export async function isGlobalAdmin(userId: string): Promise<boolean> {
  const row = (await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId)) as UserAdminRow | undefined;
  return row?.is_admin === 1;
}

/**
 * Facts a caller has already read, so the check does not query them again:
 * `isAdmin` from the session user, `ownerId` from the project row.
 */
export interface KnownFacts {
  isAdmin?: boolean;
  ownerId?: string | null;
}

/**
 * Facts a caller has already read, so the check does not query them again:
 * `isAdmin` from the session user, `ownerId` from the project row.
 */
export interface KnownFacts {
  isAdmin?: boolean;
  ownerId?: string | null;
}

/**
 * A project with zero teams and zero people assigned defaults to `view` for
 * every logged-in user; assigning even one flips it from open to restricted —
 * only those teams' members and those people (at their granted level), the
 * project's creator, and global admins can see it. Global admins and the
 * creator always get an unconditional `administrator` regardless of grants.
 * A person's own grant and their teams' add up: the highest wins.
 */
export async function getEffectivePermission(
  userId: string,
  projectId: string,
  known: KnownFacts = {},
): Promise<PermissionLevel | null> {
  if (known.isAdmin ?? (await isGlobalAdmin(userId))) return "administrator";

  let ownerId = known.ownerId;
  if (ownerId === undefined) {
    const project = (await db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(projectId)) as
      ProjectOwnerRow | undefined;
    if (!project) return null;
    ownerId = project.owner_id;
  }
  if (ownerId === userId) return "administrator";

  const grants = (await db
    .prepare(
      `SELECT pt.permission AS permission
       FROM project_teams pt
       JOIN team_members tm ON tm.team_id = pt.team_id
       WHERE pt.project_id = ? AND tm.user_id = ?
       UNION ALL
       SELECT permission FROM project_members WHERE project_id = ? AND user_id = ?`,
    )
    .all(projectId, userId, projectId, userId)) as GrantRow[];

  if (grants.length > 0) {
    return grants.reduce((best, g) => (RANK[g.permission] > RANK[best] ? g.permission : best), grants[0].permission);
  }

  const restricted = await db
    .prepare(
      `SELECT 1 FROM project_teams WHERE project_id = ?
       UNION ALL
       SELECT 1 FROM project_members WHERE project_id = ? LIMIT 1`,
    )
    .get(projectId, projectId);
  return restricted ? null : "view";
}

/**
 * `getEffectivePermission` for every project at once — the list/search
 * endpoints used to call it per project (3-4 queries each). Same rules, but
 * the grants and the "restricted" markers are read in bulk (one query each)
 * and combined in memory. Projects missing from the map do not exist.
 */
export async function getEffectivePermissions(
  userId: string,
  isAdmin?: boolean,
): Promise<Map<string, PermissionLevel | null>> {
  const projects = (await db.prepare("SELECT id, owner_id FROM projects").all()) as
    (ProjectOwnerRow & { id: string })[];
  const result = new Map<string, PermissionLevel | null>();
  if (isAdmin ?? (await isGlobalAdmin(userId))) {
    for (const p of projects) result.set(p.id, "administrator");
    return result;
  }

  const best = new Map<string, PermissionLevel>();
  const grants = (await db
    .prepare(
      `SELECT pt.project_id AS project_id, pt.permission AS permission
       FROM project_teams pt
       JOIN team_members tm ON tm.team_id = pt.team_id
       WHERE tm.user_id = ?
       UNION ALL
       SELECT project_id, permission FROM project_members WHERE user_id = ?`,
    )
    .all(userId, userId)) as (GrantRow & { project_id: string })[];
  for (const g of grants) {
    const current = best.get(g.project_id);
    if (!current || RANK[g.permission] > RANK[current]) best.set(g.project_id, g.permission);
  }

  const restricted = new Set(
    (
      (await db
        .prepare("SELECT project_id FROM project_teams UNION SELECT project_id FROM project_members")
        .all()) as { project_id: string }[]
    ).map((r) => r.project_id),
  );

  for (const p of projects) {
    if (p.owner_id === userId) result.set(p.id, "administrator");
    else result.set(p.id, best.get(p.id) ?? (restricted.has(p.id) ? null : "view"));
  }
  return result;
}

export async function hasPermission(
  userId: string,
  projectId: string,
  min: PermissionLevel,
  known: KnownFacts = {},
): Promise<boolean> {
  const level = await getEffectivePermission(userId, projectId, known);
  return level !== null && permissionAtLeast(level, min);
}

/** May plan, deploy and roll back on the project: `deploy` or `administrator`. */
export async function canDeployProject(userId: string, projectId: string): Promise<boolean> {
  return await hasPermission(userId, projectId, "deploy");
}

export async function canManageProject(userId: string, projectId: string): Promise<boolean> {
  return (await getEffectivePermission(userId, projectId)) === "administrator";
}
