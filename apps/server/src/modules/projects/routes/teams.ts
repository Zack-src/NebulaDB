import type { FastifyInstance } from "fastify";
import { auditUser } from "../../../shared/audit.js";
import { isPermissionLevel } from "../../../shared/permissions.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin } from "../../../shared/guards.js";
import { revalidateRoom } from "../../../realtime/roomRegistry.js";
import {
  grantMemberPermission,
  grantTeamPermission,
  listProjectMembers,
  listProjectTeams,
  revokeMemberPermission,
  revokeTeamPermission,
  teamExists,
} from "../repository.js";
import { getUserIdentity } from "../../users/repository.js";

export function registerProjectTeamRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/teams", async (req) => {
    const { id } = req.params as { id: string };
    await requireProjectAccess(req, id, "view");
    return await listProjectTeams(id);
  });

  app.put("/api/projects/:id/teams/:teamId", async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    const { user } = await requireProjectAdmin(req, id);
    if (!(await teamExists(teamId))) throw new ApiError("TEAM_NOT_FOUND");

    const { permission } = (req.body ?? {}) as { permission?: string };
    if (!isPermissionLevel(permission)) throw new ApiError("PERMISSION_INVALID");

    await grantTeamPermission(id, teamId, permission);
    // Sockets already open on this project resolved their access when they
    // connected; without this, a downgrade to `view` (or a first grant that
    // restricts a previously-open project) wouldn't reach them for up to the
    // room's re-check interval.
    await revalidateRoom(id);
    await auditUser(user, "project.team.grant", { type: "project", id }, `team ${teamId} -> ${permission}`, req);
    return { projectId: id, teamId, permission };
  });

  app.delete("/api/projects/:id/teams/:teamId", async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    const { user } = await requireProjectAdmin(req, id);
    await revokeTeamPermission(id, teamId);
    await revalidateRoom(id);
    await auditUser(user, "project.team.revoke", { type: "project", id }, `team ${teamId}`, req);
    return { removed: true };
  });

  // A level given to one person rather than to a team — how someone becomes
  // administrator of a project they did not create. Read by the project's
  // administrators only: it names accounts, which the team list does not.
  app.get("/api/projects/:id/members", async (req) => {
    const { id } = req.params as { id: string };
    await requireProjectAdmin(req, id);
    return await listProjectMembers(id);
  });

  app.put("/api/projects/:id/members/:userId", async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { user } = await requireProjectAdmin(req, id);
    const target = await getUserIdentity(userId);
    if (!target) throw new ApiError("USER_ID_INVALID");

    const { permission } = (req.body ?? {}) as { permission?: string };
    if (!isPermissionLevel(permission)) throw new ApiError("PERMISSION_INVALID");

    await grantMemberPermission(id, userId, permission, user.id);
    // As for a team: a first grant restricts a project that was open, and a
    // lowered one must reach the sockets already connected.
    await revalidateRoom(id);
    await auditUser(user, "project.member.grant", { type: "project", id }, `${target.email} -> ${permission}`, req);
    return { projectId: id, userId, permission };
  });

  app.delete("/api/projects/:id/members/:userId", async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { user } = await requireProjectAdmin(req, id);
    await revokeMemberPermission(id, userId);
    await revalidateRoom(id);
    await auditUser(
      user,
      "project.member.revoke",
      { type: "project", id },
      (await getUserIdentity(userId))?.email ?? userId,
      req,
    );
    return { removed: true };
  });
}
