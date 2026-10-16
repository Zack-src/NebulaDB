import type { FastifyRequest } from "fastify";
import type { SessionUser } from "../modules/auth/session.js";
import { getEffectivePermission, hasPermission, type PermissionLevel } from "./permissions.js";
import { getProjectRow, type ProjectRow } from "../modules/projects/repository.js";
import { ApiError } from "./errors.js";

/**
 * Throwing guards.
 *
 * The `requireUser(req, reply); if (!user) return;` pair these replace had to be
 * repeated at the top of every handler, and forgetting the `if` silently left
 * the route unauthenticated. A throw cannot be forgotten, and the narrowed
 * return type means the rest of the handler works with a non-null user.
 */

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new ApiError("AUTH_REQUIRED");
  return req.user;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (!user.isAdmin) throw new ApiError("ADMIN_REQUIRED");
  return user;
}

export interface ProjectAccess {
  user: SessionUser;
  project: ProjectRow;
}

/**
 * Resolves "is this caller allowed to do X to this project?" in one step —
 * authenticated, project exists, permission level sufficient — which was
 * seventeen near-identical eight-line preambles across the project routes.
 */
export async function requireProjectAccess(
  req: FastifyRequest,
  projectId: string,
  level: PermissionLevel,
): Promise<ProjectAccess> {
  const user = requireUser(req);
  const project = await getProjectRow(projectId);
  if (!project) throw new ApiError("NOT_FOUND");
  if (!(await hasPermission(user.id, projectId, level))) throw new ApiError("FORBIDDEN");
  return { user, project };
}

/** `administrator` on the project specifically — renames, deletion, team grants. */
export async function requireProjectAdmin(req: FastifyRequest, projectId: string): Promise<ProjectAccess> {
  const user = requireUser(req);
  const project = await getProjectRow(projectId);
  if (!project) throw new ApiError("NOT_FOUND");
  if ((await getEffectivePermission(user.id, projectId)) !== "administrator") throw new ApiError("FORBIDDEN");
  return { user, project };
}
