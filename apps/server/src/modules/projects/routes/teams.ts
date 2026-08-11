import type { FastifyInstance } from "fastify";
import { auditUser } from "../../../shared/audit.js";
import { isPermissionLevel } from "../../../shared/permissions.js";
import { ApiError } from "../../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin } from "../../../shared/guards.js";
import { revalidateRoom } from "../../../realtime/room.js";
import { grantTeamPermission, listProjectTeams, revokeTeamPermission, teamExists } from "../repository.js";

export function registerProjectTeamRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/teams", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    return listProjectTeams(id);
  });

  app.put("/api/projects/:id/teams/:teamId", async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    const { user } = requireProjectAdmin(req, id);
    if (!teamExists(teamId)) throw new ApiError("TEAM_NOT_FOUND");

    const { permission } = (req.body ?? {}) as { permission?: string };
    if (!isPermissionLevel(permission)) throw new ApiError("PERMISSION_INVALID");

    grantTeamPermission(id, teamId, permission);
    // Sockets already open on this project resolved their access when they
    // connected; without this, a downgrade to `view` (or a first grant that
    // restricts a previously-open project) wouldn't reach them for up to the
    // room's re-check interval.
    revalidateRoom(id);
    auditUser(user, "project.team.grant", { type: "project", id }, `team ${teamId} -> ${permission}`, req);
    return { projectId: id, teamId, permission };
  });

  app.delete("/api/projects/:id/teams/:teamId", async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    const { user } = requireProjectAdmin(req, id);
    revokeTeamPermission(id, teamId);
    revalidateRoom(id);
    auditUser(user, "project.team.revoke", { type: "project", id }, `team ${teamId}`, req);
    return { removed: true };
  });
}
